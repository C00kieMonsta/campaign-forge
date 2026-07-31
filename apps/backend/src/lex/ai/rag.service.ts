import { Injectable } from "@nestjs/common";
import type { LexPin } from "@packages/types";
import { OpenAiService } from "../../shared/openai.service";
import { PgService } from "../../shared/pg.service";
import { reciprocalRankFusion } from "./rag-fusion";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  filename: string;
  pageFrom: number | null;
  pageTo: number | null;
  charStart: number | null;
  charEnd: number | null;
  content: string;
  score: number;
}

interface ChunkRow {
  id: string;
  document_id: string;
  filename: string;
  page_from: number | null;
  page_to: number | null;
  char_start: number | null;
  char_end: number | null;
  content: string;
}

interface PageRowResult {
  id: string;
  document_id: string;
  filename: string;
  page_number: number | null;
  page_label: string;
  char_start: number;
  char_end: number;
  text: string;
}

const CANDIDATE_LIMIT = 40;

/**
 * Total characters of pinned page text allowed into one prompt. Generous (a pinned page is the
 * single most relevant thing in the turn) but bounded, so pinning a 200-page exhibit cannot
 * blow the context window.
 */
const PINNED_MAX_TOTAL_CHARS = 24000;

/** True when the chunk's page span actually includes one of the pinned pages. */
function coversAnyPage(
  chunk: { page_from: number | null; page_to: number | null },
  pages: number[]
): boolean {
  const from = chunk.page_from ?? 1;
  const to = chunk.page_to ?? from;
  return pages.some((p) => p >= from && p <= to);
}

/**
 * Hybrid retrieval over a workspace's document chunks: dense (pgvector cosine on the
 * halfvec HNSW index) fused with sparse (FR+NL full-text) via Reciprocal Rank Fusion.
 * Hard-scoped by owner_email + workspace_id and to lifecycle_state='active' documents only
 * (superseded/archived filings are never retrieved), and to document chunks (conversation
 * summaries are never surfaced as a document source). Provenance (chunkId + page + char
 * offsets) is carried through so citations stay anchored to an exact span.
 */
@Injectable()
export class RagService {
  constructor(
    private pg: PgService,
    private openai: OpenAiService
  ) {}

  /**
   * The exact text of the pages the user pinned, in document order.
   *
   * Reads the PAGE index rather than chunks, which fixes two things the chunk-based version got
   * wrong. Chunks overlap and span page boundaries, so pinning page 6 returned a whole 4000-char
   * chunk covering pages 4-8 — labelled "p. 4", so the answer cited the wrong page — and pinning
   * [2, 40] selected every chunk in between, because the range filter was an envelope rather than
   * a set membership test.
   *
   * A deliberate bypass of ranking: when the lawyer says "these pages", the answer must be
   * grounded in those pages, not in whatever the embedding considers similar. An empty `pages`
   * array pins the whole document.
   *
   * Falls back to chunks for a document with no page index yet (page_index_version = 0), so this
   * works before any backfill has run.
   *
   * Still hard-scoped to owner + workspace + lifecycle_state='active', so a pin can neither reach
   * another user's document nor resurrect a superseded duplicate.
   */
  async retrievePinned(
    ownerEmail: string,
    workspaceId: string,
    pins: LexPin[],
    maxTotalChars = PINNED_MAX_TOTAL_CHARS
  ): Promise<RetrievedChunk[]> {
    if (pins.length === 0) return [];

    const out: RetrievedChunk[] = [];
    let budget = maxTotalChars;

    for (const pin of pins) {
      if (budget <= 0) break;

      // Set membership on the ordinal, not a range envelope: pinning [2, 40] must return two
      // pages, not thirty-nine.
      const pageFilter = pin.pages.length
        ? `AND p.ordinal = ANY($4::int[])`
        : "";
      const params: unknown[] = [workspaceId, ownerEmail, pin.documentId];
      if (pin.pages.length) params.push(pin.pages);

      const pages = await this.pg.query<PageRowResult>(
        `SELECT p.id, p.document_id, d.filename, p.page_number, p.page_label,
                p.char_start, p.char_end, p.text
         FROM lex_document_pages p
         JOIN lex_documents d ON d.id = p.document_id
         WHERE p.workspace_id = $1 AND p.owner_email = $2 AND p.document_id = $3
           AND d.lifecycle_state = 'active'
           ${pageFilter}
         ORDER BY p.ordinal ASC`,
        params
      );

      if (pages.rows.length === 0) {
        // No page index for this document yet — fall back to the chunk path so pinning still works
        // during the rollout.
        out.push(
          ...(await this.pinnedFromChunks(ownerEmail, workspaceId, pin, budget))
        );
        budget = Math.max(
          0,
          maxTotalChars - out.reduce((n, c) => n + c.content.length, 0)
        );
        continue;
      }

      for (const r of pages.rows) {
        if (budget <= 0) break;
        const content = r.text.slice(0, budget);
        budget -= content.length;
        out.push({
          chunkId: r.id,
          documentId: r.document_id,
          filename: r.filename,
          // The page's OWN number, so a quote from page 6 is cited as page 6. NULL for a format
          // with no pages (a section of a docx), where inventing a number would be a lie.
          pageFrom: r.page_number,
          pageTo: r.page_number,
          charStart: r.char_start,
          charEnd: r.char_end,
          content,
          // Pinned spans are not ranked; the score exists only to satisfy the shared shape.
          score: Number.POSITIVE_INFINITY
        });
      }
    }

    return out;
  }

  /** Pre-page-index fallback: the previous chunk-based pinning, kept for un-indexed documents. */
  private async pinnedFromChunks(
    ownerEmail: string,
    workspaceId: string,
    pin: LexPin,
    budget: number
  ): Promise<RetrievedChunk[]> {
    const pageFilter = pin.pages.length
      ? `AND c.page_from <= $4 AND c.page_to >= $5`
      : "";
    const params: unknown[] = [workspaceId, ownerEmail, pin.documentId];
    if (pin.pages.length) {
      params.push(Math.max(...pin.pages), Math.min(...pin.pages));
    }

    const res = await this.pg.query<ChunkRow>(
      `SELECT c.id, c.document_id, d.filename, c.page_from, c.page_to,
              c.char_start, c.char_end, c.content
       FROM lex_document_chunks c
       JOIN lex_documents d ON d.id = c.document_id
       WHERE c.workspace_id = $1 AND c.owner_email = $2 AND c.document_id = $3
         AND d.lifecycle_state = 'active'
         ${pageFilter}
       ORDER BY c.chunk_index ASC`,
      params
    );

    const out: RetrievedChunk[] = [];
    let left = budget;
    for (const r of res.rows) {
      if (left <= 0) break;
      if (pin.pages.length && !coversAnyPage(r, pin.pages)) continue;
      const content = r.content.slice(0, left);
      left -= content.length;
      out.push({
        chunkId: r.id,
        documentId: r.document_id,
        filename: r.filename,
        pageFrom: r.page_from,
        pageTo: r.page_to,
        charStart: r.char_start,
        charEnd: r.char_end,
        content,
        score: Number.POSITIVE_INFINITY
      });
    }
    return out;
  }

  async retrieve(
    ownerEmail: string,
    workspaceId: string,
    query: string,
    topK = 8
  ): Promise<RetrievedChunk[]> {
    const [qvec] = await this.openai.embed(query);
    const qvecStr = `[${qvec.join(",")}]`;

    const select = `c.id, c.document_id, d.filename, c.page_from, c.page_to, c.char_start, c.char_end, c.content`;
    const scope = `c.workspace_id = $1 AND c.owner_email = $2 AND d.lifecycle_state = 'active'`;

    const vecRes = await this.pg.query<ChunkRow>(
      `SELECT ${select}
       FROM lex_document_chunks c
       JOIN lex_documents d ON d.id = c.document_id
       WHERE ${scope}
       ORDER BY c.embedding <=> $3::halfvec
       LIMIT $4`,
      [workspaceId, ownerEmail, qvecStr, CANDIDATE_LIMIT]
    );

    const tsv = `(to_tsvector('french', c.content) || to_tsvector('dutch', c.content))`;
    const tsq = `(plainto_tsquery('french', $3) || plainto_tsquery('dutch', $3))`;
    const ftsRes = await this.pg.query<ChunkRow>(
      `SELECT ${select}
       FROM lex_document_chunks c
       JOIN lex_documents d ON d.id = c.document_id
       WHERE ${scope} AND ${tsv} @@ ${tsq}
       ORDER BY ts_rank(${tsv}, ${tsq}) DESC
       LIMIT $4`,
      [workspaceId, ownerEmail, query, CANDIDATE_LIMIT]
    );

    // Fuse the dense + sparse rankings (pure, unit-tested — see rag-fusion.ts).
    return reciprocalRankFusion([vecRes.rows, ftsRes.rows], { topK }).map(
      ({ item: r, score }) => ({
        chunkId: r.id,
        documentId: r.document_id,
        filename: r.filename,
        pageFrom: r.page_from,
        pageTo: r.page_to,
        charStart: r.char_start,
        charEnd: r.char_end,
        content: r.content,
        score
      })
    );
  }
}
