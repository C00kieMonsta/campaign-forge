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
   * Chunks for pages the user explicitly pinned in the viewer, in document order.
   *
   * This is a deliberate bypass of ranking: when the lawyer says "these pages", the answer must
   * be grounded in those pages, not in whatever the embedding happens to consider similar. An
   * empty `pages` array pins the whole document.
   *
   * Still hard-scoped to the owner, the workspace and lifecycle_state='active', so a pin can
   * neither reach another user's document nor resurrect a superseded duplicate.
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
      // Page ranges overlap the request when page_from <= max(pages) AND page_to >= min(pages).
      // A chunk spanning a page boundary is therefore included for either page — correct, since
      // its text genuinely appears on both.
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

      for (const r of res.rows) {
        if (budget <= 0) break;
        // Keep only pages actually asked for: the range filter above is inclusive of chunks that
        // merely touch the range, so a chunk covering pages 6-10 is dropped when only 7 was
        // pinned and it contributes nothing from 7 alone.
        if (pin.pages.length && !coversAnyPage(r, pin.pages)) continue;
        const content = r.content.slice(0, budget);
        budget -= content.length;
        out.push({
          chunkId: r.id,
          documentId: r.document_id,
          filename: r.filename,
          pageFrom: r.page_from,
          pageTo: r.page_to,
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
