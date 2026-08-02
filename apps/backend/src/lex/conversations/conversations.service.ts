import { randomUUID } from "node:crypto";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  LexCitationEvent,
  LexConversation,
  LexMessage,
  LexPin,
  ReasoningDepth
} from "@packages/types";
import { OpenAiService } from "../../shared/openai.service";
import { PgService } from "../../shared/pg.service";
import { sourceKey } from "../ai/rag.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { extractCitedIndexes } from "./citation-markers";
import { ContextAssembler } from "./context-assembler.service";
import { SummarizationService } from "./summarization.service";

/**
 * Messages returned per page. Roughly a screenful and a half of a long thread — enough that the
 * common case (open the chat, read the last exchange) needs exactly one request.
 */
const MESSAGE_PAGE_SIZE = 40;

interface ConversationRow {
  id: string;
  workspace_id: string;
  owner_email: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  owner_email: string;
  seq: string;
  role: LexMessage["role"];
  content: string;
  status: LexMessage["status"];
  token_count: number | null;
  created_at: Date;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapConversation(r: ConversationRow): LexConversation {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerEmail: r.owner_email,
    title: r.title,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  };
}

function mapMessage(r: MessageRow): LexMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    ownerEmail: r.owner_email,
    seq: Number(r.seq),
    role: r.role,
    content: r.content,
    status: r.status,
    tokenCount: r.token_count,
    createdAt: iso(r.created_at)
  };
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private pg: PgService,
    private openai: OpenAiService,
    private workspaces: WorkspacesService,
    private assembler: ContextAssembler,
    private summarization: SummarizationService
  ) {}

  async create(
    ownerEmail: string,
    workspaceId: string,
    data: { title?: string }
  ): Promise<LexConversation> {
    await this.workspaces.getOrFail(ownerEmail, workspaceId);
    const res = await this.pg.query<ConversationRow>(
      `INSERT INTO lex_conversations (workspace_id, owner_email, title)
       VALUES ($1, $2, $3) RETURNING *`,
      [workspaceId, ownerEmail, data.title ?? null]
    );
    return mapConversation(res.rows[0]);
  }

  async list(
    ownerEmail: string,
    workspaceId: string
  ): Promise<LexConversation[]> {
    await this.workspaces.getOrFail(ownerEmail, workspaceId);
    const res = await this.pg.query<ConversationRow>(
      `SELECT * FROM lex_conversations WHERE workspace_id = $1 AND owner_email = $2
       ORDER BY updated_at DESC`,
      [workspaceId, ownerEmail]
    );
    return res.rows.map(mapConversation);
  }

  async getOrFail(ownerEmail: string, id: string): Promise<LexConversation> {
    const res = await this.pg.query<ConversationRow>(
      `SELECT * FROM lex_conversations WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
    if (res.rows.length === 0)
      throw new NotFoundException("Conversation not found");
    return mapConversation(res.rows[0]);
  }

  async rename(
    ownerEmail: string,
    id: string,
    title: string
  ): Promise<LexConversation> {
    const res = await this.pg.query<ConversationRow>(
      `UPDATE lex_conversations SET title = $3, updated_at = now()
       WHERE id = $1 AND owner_email = $2 RETURNING *`,
      [id, ownerEmail, title]
    );
    if (res.rows.length === 0)
      throw new NotFoundException("Conversation not found");
    return mapConversation(res.rows[0]);
  }

  async delete(ownerEmail: string, id: string): Promise<void> {
    const res = await this.pg.query(
      `DELETE FROM lex_conversations WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
    if (res.rowCount === 0)
      throw new NotFoundException("Conversation not found");
  }

  /**
   * A page of messages, newest-first internally but returned in chronological order.
   *
   * These conversations are meant to run for years, so the whole thread is never fetched: the
   * client asks for the most recent `limit`, then walks backwards with `beforeSeq` as the user
   * scrolls up. `hasMore` tells it whether anything older exists, so it can stop.
   */
  async messages(
    ownerEmail: string,
    id: string,
    opts: { beforeSeq?: number; limit?: number } = {}
  ): Promise<{ items: LexMessage[]; hasMore: boolean }> {
    await this.getOrFail(ownerEmail, id);
    const limit = Math.min(Math.max(opts.limit ?? MESSAGE_PAGE_SIZE, 1), 200);

    const params: unknown[] = [id];
    let cursor = "";
    if (opts.beforeSeq !== undefined) {
      params.push(opts.beforeSeq);
      cursor = `AND seq < $${params.length}`;
    }
    params.push(limit + 1); // one extra row reveals whether an older page exists

    const res = await this.pg.query<MessageRow>(
      `SELECT * FROM lex_messages
       WHERE conversation_id = $1 AND status <> 'pending' ${cursor}
       ORDER BY seq DESC
       LIMIT $${params.length}`,
      params
    );

    const hasMore = res.rows.length > limit;
    const page = hasMore ? res.rows.slice(0, limit) : res.rows;
    // Reverse into chronological order — the DESC + LIMIT was only how to reach the newest.
    return { items: page.reverse().map(mapMessage), hasMore };
  }

  /**
   * Streams an assistant reply. Persistence is pending→finalize and idempotent: the user
   * turn + an empty 'pending' assistant row are written first (so a dropped connection
   * leaves a recoverable record), then the finalize transaction fills the assistant row and
   * inserts citations only for the sources actually referenced (via [n] markers).
   */
  async streamReply(
    ownerEmail: string,
    conversationId: string,
    content: string,
    onToken: (delta: string) => void,
    /** Pages the user pinned in the viewer; they constrain retrieval for this turn. */
    pins: LexPin[] = [],
    /** How hard to think about this turn. See the model registry for what each depth costs. */
    depth?: ReasoningDepth
  ): Promise<{ messageId: string; citations: LexCitationEvent[] }> {
    const conv = await this.getOrFail(ownerEmail, conversationId);

    const assistantId = randomUUID();

    // `seq` is UNIQUE per conversation, so reading MAX(seq) and then inserting is only safe if
    // nothing else can allocate in between. Lock the conversation row FIRST, inside the same
    // transaction: a background task posting its result into this conversation (see
    // TaskRunnerService.postResult, which takes the same lock) would otherwise pick the same seq
    // and one of the two would die on a unique violation — losing either the user's turn or the
    // result of a ten-minute run.
    await this.pg.withTransaction(async (client) => {
      await client.query(
        `SELECT 1 FROM lex_conversations WHERE id = $1 FOR UPDATE`,
        [conversationId]
      );
      const seqRes = await client.query<{ m: string }>(
        `SELECT COALESCE(MAX(seq), 0) AS m FROM lex_messages WHERE conversation_id = $1`,
        [conversationId]
      );
      const base = Number(seqRes.rows[0].m);
      await client.query(
        `INSERT INTO lex_messages (conversation_id, owner_email, seq, role, content, status)
         VALUES ($1, $2, $3, 'user', $4, 'complete')`,
        [conversationId, ownerEmail, base + 1, content]
      );
      await client.query(
        `INSERT INTO lex_messages (id, conversation_id, owner_email, seq, role, content, status)
         VALUES ($1, $2, $3, $4, 'assistant', '', 'pending')`,
        [assistantId, conversationId, ownerEmail, base + 2]
      );
    });

    const { messages, sources } = await this.assembler.assemble(
      ownerEmail,
      conv.workspaceId,
      conversationId,
      content,
      pins
    );

    let full = "";
    try {
      for await (const delta of this.openai.streamChat(messages, { depth })) {
        full += delta;
        onToken(delta);
      }
    } catch (err) {
      // Keep whatever arrived, under status 'failed'. A stream can now end incomplete — truncated,
      // content-filtered, or empty — and the two wrong answers are symmetric: storing the fragment
      // as 'complete' hands the reader a legal answer that stops mid-sentence with nothing saying
      // so, and dropping it throws away a page of work she watched appear on screen. 'failed' plus
      // the text is the honest pair.
      await this.pg.query(
        `UPDATE lex_messages SET status = 'failed', content = $2 WHERE id = $1`,
        [assistantId, full]
      );
      throw err;
    }

    // Attribute only the sources the model actually cited via [n] markers.
    const citations: LexCitationEvent[] = extractCitedIndexes(
      full,
      sources.length
    ).map((n) => {
      const s = sources[n - 1];
      return {
        index: n,
        // The opaque source key, not a raw id — see lexCitationEventSchema. The real anchors go
        // to their own typed columns in the INSERT below.
        chunkId: sourceKey(s),
        documentId: s.documentId,
        filename: s.filename,
        pageFrom: s.pageFrom,
        pageTo: s.pageTo,
        quote: s.content.slice(0, 240)
      };
    });

    const derivedTitle = content.trim().slice(0, 60) || "Conversation";

    await this.pg.withTransaction(async (client) => {
      const upd = await client.query(
        `UPDATE lex_messages
         SET content = $2, status = 'complete', token_count = $3
         WHERE id = $1 AND status = 'pending'`,
        [assistantId, full, Math.ceil(full.length / 4)]
      );
      // Only persist citations if the finalize actually applied (idempotent on retry).
      if ((upd.rowCount ?? 0) > 0) {
        for (const c of citations) {
          if (c.index === undefined) continue;
          const s = sources[c.index - 1];
          if (!s) continue;
          // chunk_id and page_id are separate foreign keys to separate tables, and RetrievedChunk
          // sets exactly one of them. Writing a page's id into chunk_id raises 23503 INSIDE this
          // transaction, which rolls back the `status = 'complete'` above — the user watches a
          // complete answer stream in and then finds the message stuck pending, with the money
          // already spent. page_ordinal + page_text_hash travel with the page id so a later
          // rebuild of the page index can re-anchor this citation, or honestly refuse to.
          await client.query(
            `INSERT INTO lex_citations
               (owner_email, message_id, chunk_id, page_id, page_ordinal, page_text_hash,
                document_id, quote, page_from, page_to, char_start, char_end)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              ownerEmail,
              assistantId,
              s.chunkId,
              s.pageId,
              s.pageOrdinal,
              s.pageTextHash,
              s.documentId,
              s.content.slice(0, 240),
              s.pageFrom,
              s.pageTo,
              s.charStart,
              s.charEnd
            ]
          );
        }
      }
      await client.query(
        `UPDATE lex_conversations SET updated_at = now(), title = COALESCE(title, $2) WHERE id = $1`,
        [conversationId, derivedTitle]
      );
    });

    // Best-effort rolling checkpoint; never fail the reply on a summary error. A miss is absorbed
    // by ContextAssembler's RECENT_TURN_LIMIT headroom, and the fold is batched so a backlog drains
    // rather than compounding.
    //
    // LOGGED, not discarded. `.catch(() => undefined)` meant a checkpoint could fail on every turn
    // of a long case thread with no trace anywhere — and the symptom, a thread quietly losing its
    // own early history, surfaces far from the cause.
    await this.summarization
      .maybeCheckpoint(conversationId, ownerEmail)
      .catch((err: unknown) =>
        this.logger.warn(
          JSON.stringify({
            level: "warn",
            action: "lexConvSummaryFailed",
            conversationId,
            error: String(err)
          })
        )
      );

    return { messageId: assistantId, citations };
  }
}
