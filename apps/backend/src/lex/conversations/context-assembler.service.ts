import { Injectable, Logger } from "@nestjs/common";
import type { LexPin } from "@packages/types";
import type OpenAI from "openai";
import { PgService } from "../../shared/pg.service";
import {
  RagService,
  sourceKey,
  withoutPinned,
  type RetrievedChunk
} from "../ai/rag.service";
import {
  AuthoritiesService,
  type RetrievedArticle
} from "../authorities/authorities.service";
import { outputLanguageInstruction } from "../settings/language-instruction";
import { SettingsService } from "../settings/settings.service";

// Verbatim-turn window. Deliberately LARGER than SummarizationService's CHECKPOINT_THRESHOLD:
// the checkpoint is best-effort (its failures are swallowed), so the window needs headroom to
// absorb a missed checkpoint or two without truncating live history.
const RECENT_TURN_LIMIT = 24;
const MAX_CHUNK_CHARS = 2000;
const TOP_K = 8;
/**
 * Even with pages pinned, keep a few slots for hybrid search: the answer often needs context the
 * user did not think to pin (an earlier filing that contradicts the pinned page, for instance).
 */
const MIN_SEARCH_SLOTS = 3;

/**
 * Token ceiling for the verbatim-turn portion of the prompt.
 *
 * The count is estimated, not tokenised: at ~3.4 chars/token for FR/NL prose this is accurate
 * enough given the headroom below gpt-4o's 128k window, and a real tokeniser (tiktoken) would add
 * a dependency and per-turn CPU on a box that is already sharing with the Campaigns API. The
 * point is a HARD upper bound so a thread of pasted letters cannot push out the SOURCES block —
 * not exact accounting.
 */
const MAX_TURN_TOKENS = 12000;
const CHARS_PER_TOKEN = 3.4;

/**
 * Articles of law pulled in per turn, on top of the always-present digests. Smaller than the
 * document TOP_K: a statute answers in one or two articles, and the digest already says what
 * exists — this is for the verbatim wording when it matters.
 */
const AUTHORITY_TOP_K = 4;
/** Per-article cap. Belgian code articles are short; a long one is a consolidated section. */
const MAX_AUTHORITY_CHARS = 3000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

interface MessageRow {
  role: string;
  content: string;
}

interface SummaryRow {
  through_message_seq: string;
  summary: string;
}

export interface AssembledContext {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  sources: RetrievedChunk[];
}

/**
 * Builds the bounded prompt for a chat turn: system instructions + durable conversation
 * summary (older turns, compressed) + recent verbatim turns (after the summary watermark) +
 * a first-class SOURCES block from retrieval. Sources are never evicted — grounding has a
 * reserved floor so the model always has documents to cite from.
 */
@Injectable()
export class ContextAssembler {
  private readonly logger = new Logger(ContextAssembler.name);

  constructor(
    private pg: PgService,
    private rag: RagService,
    private settings: SettingsService,
    private authorities: AuthoritiesService
  ) {}

  async assemble(
    ownerEmail: string,
    workspaceId: string,
    conversationId: string,
    query: string,
    pins: LexPin[] = []
  ): Promise<AssembledContext> {
    // Pinned pages first and verbatim — they are what the user pointed at. Hybrid search then
    // fills the remaining slots, skipping anything the pins already cover so a source is never
    // listed twice under two different [n] markers.
    const pinned = await this.rag.retrievePinned(ownerEmail, workspaceId, pins);
    const pinnedKeys = new Set(pinned.map(sourceKey));
    const searched = withoutPinned(
      await this.rag.retrieve(ownerEmail, workspaceId, query, TOP_K),
      pinned
    );

    const searchSlots = Math.max(
      MIN_SEARCH_SLOTS,
      TOP_K - Math.min(pinned.length, TOP_K - MIN_SEARCH_SLOTS)
    );
    const sources = [...pinned, ...searched.slice(0, searchSlots)];

    // What the turn was actually grounded in. Logged because "the answer ignored my pinned page"
    // is otherwise indistinguishable from "the pin never arrived" or "those pages have no indexed
    // text" — three different faults with three different fixes.
    if (pins.length > 0) {
      this.logger.log(
        JSON.stringify({
          action: "lexPinnedSources",
          conversationId,
          pinsRequested: pins.length,
          pagesRequested: pins.flatMap((p) => p.pages),
          pinnedChunks: pinned.length,
          searchChunks: sources.length - pinned.length
        })
      );
    }

    const summaryRes = await this.pg.query<SummaryRow>(
      `SELECT through_message_seq, summary FROM lex_conversation_summaries
       WHERE conversation_id = $1 ORDER BY through_message_seq DESC LIMIT 1`,
      [conversationId]
    );
    const summary = summaryRes.rows[0];
    const watermark = summary ? Number(summary.through_message_seq) : 0;

    // Take the NEWEST turns, then restore chronological order for the prompt. Selecting the
    // oldest N instead would drop the newest messages — including the question being asked
    // right now — whenever more than N messages sit past the watermark (which happens as soon
    // as one best-effort checkpoint fails).
    const msgRes = await this.pg.query<MessageRow>(
      `SELECT role, content FROM (
         SELECT seq, role, content FROM lex_messages
         WHERE conversation_id = $1 AND status = 'complete' AND seq > $2
         ORDER BY seq DESC
         LIMIT $3
       ) recent
       ORDER BY seq ASC`,
      [conversationId, watermark, RECENT_TURN_LIMIT]
    );

    const sourcesBlock = sources.length
      ? sources
          .map(
            (s, i) =>
              `[${i + 1}] (${s.filename}${s.pageFrom ? `, p.${s.pageFrom}` : ""})` +
              `${pinnedKeys.has(sourceKey(s)) ? " [PINNED BY THE USER]" : ""}:\n` +
              // Pinned text is never truncated by the per-chunk cap — retrievePinned already
              // applied its own total budget, and clipping a page the user pointed at is worse
              // than a slightly longer prompt.
              (pinnedKeys.has(sourceKey(s))
                ? s.content
                : s.content.slice(0, MAX_CHUNK_CHARS))
          )
          .join("\n\n")
      : "(no relevant documents found in this workspace)";

    const pinnedNote =
      pinned.length > 0
        ? " The user has PINNED specific pages: those sources are the subject of the question — " +
          "read them closely and answer from them first. The unpinned sources are supporting " +
          "context only."
        : "";

    const language = await this.settings.languageOf(ownerEmail);

    // ── Authorities ──────────────────────────────────────────────────────────────────────
    // The law the user uploaded, present on EVERY turn in two forms:
    //  1. the digest — a compact article-numbered map of each enabled authority, so the model
    //     knows what law exists and which article to reach for;
    //  2. retrieved article text, when the question touches something in it.
    // Both are best-effort: a missing digest degrades the answer, but must never fail the turn.
    const digests = await this.authorities.enabledDigests(ownerEmail);
    const articles = await this.authorities
      .retrieve(ownerEmail, query, AUTHORITY_TOP_K)
      .catch(() => [] as RetrievedArticle[]);

    const system =
      "You are Lex, a meticulous legal assistant for Belgian-law court files. " +
      // Without this the model treats "can you read this page?" as a question about its own
      // capabilities and refuses ("I cannot access PDF files"), even while the page's text sits
      // in front of it. The SOURCES are already-extracted text, not attachments to open.
      "The SOURCES below are the EXTRACTED TEXT of the user's own documents — they are already " +
      "in front of you. You are therefore ALWAYS able to read the pages and documents the user " +
      "refers to: read them from the SOURCES. Never reply that you cannot access a file, open a " +
      "PDF, or see a document; if a specific page or document is not among the SOURCES, name " +
      "what is missing instead. " +
      "Answer using the numbered SOURCES (the case file) and the APPLICABLE LAW section. " +
      "Cite every factual claim inline with its source marker, e.g. [1] or [2]. If the SOURCES " +
      "do not contain the answer, say so plainly and do not speculate. Format your answer as " +
      "Markdown: short paragraphs, `##` headings when the answer has parts, bullet lists for " +
      "enumerations, tables for comparisons, and blockquotes for text quoted from a source. " +
      "Never wrap the whole answer in a code fence." +
      pinnedNote;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system }
    ];

    // Law goes in BEFORE the case file and before the conversation: it is the frame the facts are
    // read against, and it outranks both the documents and the model's own recollection of what
    // Belgian law says. Stated explicitly because a model asked about art. 374 will otherwise
    // happily answer from memory — which is exactly the failure mode that makes a legal tool
    // unusable, since a plausible wrong article is worse than "I don't have that".
    if (digests.length > 0 || articles.length > 0) {
      const digestBlock = digests
        .map((d) => `### ${d.title}\n${d.digest}`)
        .join("\n\n");
      const articleBlock = articles.length
        ? "\n\nVERBATIM TEXT of the articles most relevant to this question:\n\n" +
          articles
            .map(
              (a) =>
                `[${a.articleLabel ?? "?"} — ${a.title}]\n` +
                a.content.slice(0, MAX_AUTHORITY_CHARS)
            )
            .join("\n\n")
        : "";

      messages.push({
        role: "system",
        content:
          "APPLICABLE LAW — treat this as authoritative and non-negotiable. It was supplied by " +
          "the user and takes precedence over the case documents, over anything earlier in this " +
          "conversation, and over your own training. Never contradict it. Never state a rule of " +
          "law that is not present here: if the answer depends on law that is not included, say " +
          "so and name what is missing. When you rely on an article, cite it by its number " +
          "(e.g. « art. 374 »).\n\n" +
          (digestBlock ||
            "(no article map available for the uploaded authorities)") +
          articleBlock
      });
    }

    if (summary) {
      messages.push({
        role: "system",
        content: `Summary of earlier conversation:\n${summary.summary}`
      });
    }
    messages.push({ role: "system", content: `SOURCES:\n${sourcesBlock}` });
    // Last system message, so the language pin is the most recent instruction the model reads.
    // Sources and prior turns are frequently in another language and would otherwise drag the
    // reply along with them.
    messages.push({
      role: "system",
      content: outputLanguageInstruction(language)
    });

    // Verbatim turns are the only evictable part of the prompt: the system instructions, the
    // rolling summary and the SOURCES block all have to be there for the answer to be grounded
    // and citable. Drop from the OLDEST until the turns fit their budget — the newest turns
    // (including the question being asked) are never the ones sacrificed.
    const turns = msgRes.rows.filter(
      (m) => m.role === "user" || m.role === "assistant"
    );
    let turnBudget = MAX_TURN_TOKENS;
    const kept: MessageRow[] = [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const cost = estimateTokens(turns[i].content);
      if (kept.length > 0 && cost > turnBudget) break;
      turnBudget -= cost;
      kept.push(turns[i]);
    }
    kept.reverse();

    for (const m of kept) {
      messages.push({
        role: m.role as "user" | "assistant",
        content: m.content
      });
    }

    if (kept.length < turns.length) {
      this.logger.log(
        JSON.stringify({
          action: "lexContextTrimmed",
          conversationId,
          droppedTurns: turns.length - kept.length,
          keptTurns: kept.length
        })
      );
    }

    return { messages, sources };
  }
}
