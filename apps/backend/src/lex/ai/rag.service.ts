import { Injectable } from "@nestjs/common";
import type { LexPin } from "@packages/types";
import { OpenAiService } from "../../shared/openai.service";
import { PgService } from "../../shared/pg.service";
import { pageTextHash } from "../documents/pager";
import { discriminatingTerms } from "./fts-terms";
import { reciprocalRankFusion } from "./rag-fusion";

/**
 * A retrieved span of a document, carrying the provenance a citation is filed against.
 *
 * The anchor is TWO mutually exclusive fields rather than one id, because a chunk and a page live
 * in different tables and lex_citations has a separate foreign key per table. Carrying both in a
 * single `chunkId` is what let a lex_document_pages id be INSERTed into lex_citations.chunk_id,
 * whose FK targets lex_document_chunks: Postgres 23503 inside the finalize transaction, which
 * rolled back `status = 'complete'` and destroyed an answer the user had already watched stream in.
 * Exactly one of chunkId / pageId is non-null.
 */
export interface RetrievedChunk {
  /** lex_document_chunks id. Null when this span came from the page index. */
  chunkId: string | null;
  /** lex_document_pages id. Null when this span came from a chunk. */
  pageId: string | null;
  /** The page's reading-order ordinal, and the hash of the exact text, so a filed citation can
   *  detect that the page it points at has since been rebuilt with different text. */
  pageOrdinal: number | null;
  pageTextHash: string | null;
  documentId: string;
  filename: string;
  pageFrom: number | null;
  pageTo: number | null;
  charStart: number | null;
  charEnd: number | null;
  content: string;
  score: number;
}

/**
 * Stable identity for a retrieved span, for dedup and for the "is this pinned" test.
 *
 * Prefixed by table: a chunk id and a page id are both UUIDs and could never collide in practice,
 * but an unprefixed key would silently compare across id spaces, which is the same category of
 * mistake as the FK bug above.
 */
export function sourceKey(c: RetrievedChunk): string {
  return c.chunkId ? `chunk:${c.chunkId}` : `page:${c.pageId}`;
}

/**
 * True when a searched chunk's text is already covered by one of the pinned spans.
 *
 * Compares CHAR SPANS, not ids. Once a document has a page index, a pinned page and a searched
 * chunk of the same passage are rows in different tables with different ids, so an id-based test
 * silently stops matching and the same text is sent twice under two different [n] markers —
 * paying tokens for it and inviting the model to cite the weaker anchor.
 */
function overlapsPinned(c: RetrievedChunk, pinned: RetrievedChunk[]): boolean {
  if (c.charStart === null || c.charEnd === null) return false;
  return pinned.some(
    (p) =>
      p.documentId === c.documentId &&
      p.charStart !== null &&
      p.charEnd !== null &&
      // Half-open intervals: touching end-to-start is not an overlap.
      c.charStart! < p.charEnd &&
      p.charStart < c.charEnd!
  );
}

/** Drops searched spans already covered by a pin, by identity or by char-span overlap. */
export function withoutPinned(
  searched: RetrievedChunk[],
  pinned: RetrievedChunk[]
): RetrievedChunk[] {
  const keys = new Set(pinned.map(sourceKey));
  return searched.filter(
    (c) => !keys.has(sourceKey(c)) && !overlapsPinned(c, pinned)
  );
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
  ordinal: number;
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
        `SELECT p.id, p.document_id, d.filename, p.ordinal, p.page_number, p.page_label,
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
          // A PAGE anchor: chunkId stays null so this id can never reach lex_citations.chunk_id.
          chunkId: null,
          pageId: r.id,
          pageOrdinal: r.ordinal,
          // Hashed from the FULL page text, not the budget-truncated `content`, and with
          // pageTextHash — the same function the page-index rebuild re-anchors on. The row's own
          // text_fingerprint is a different thing (normalised, and null under 200 chars), so using
          // it here would make every re-anchor after a rebuild miss.
          pageTextHash: pageTextHash(r.text),
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
        pageId: null,
        pageOrdinal: null,
        pageTextHash: null,
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
    topK = 8,
    /**
     * Restrict to these documents. Undefined means the whole workspace; an EMPTY array means
     * nothing matches, which is a real answer (a selection whose documents are all archived) and
     * not "ignore me".
     */
    documentIds?: readonly string[]
  ): Promise<RetrievedChunk[]> {
    const [qvec] = await this.openai.embed(query);
    const qvecStr = `[${qvec.join(",")}]`;

    const select = `c.id, c.document_id, d.filename, c.page_from, c.page_to, c.char_start, c.char_end, c.content`;
    // $5 rather than appending: the dense and sparse queries already use $1..$4, and a selection
    // filter that shifted their placeholders would be a silent mis-binding rather than an error.
    const selection = documentIds ? ` AND c.document_id = ANY($5::uuid[])` : "";
    const scope =
      `c.workspace_id = $1 AND c.owner_email = $2 AND d.lifecycle_state = 'active'` +
      selection;

    const vecRes = await this.pg.query<ChunkRow>(
      `SELECT ${select}
       FROM lex_document_chunks c
       JOIN lex_documents d ON d.id = c.document_id
       WHERE ${scope}
       ORDER BY c.embedding <=> $3::halfvec
       LIMIT $4`,
      [
        workspaceId,
        ownerEmail,
        qvecStr,
        CANDIDATE_LIMIT,
        ...(documentIds ? [documentIds] : [])
      ]
    );

    const tsv = `(to_tsvector('french', c.content) || to_tsvector('dutch', c.content))`;
    /**
     * The sparse half searches only the question's DISCRIMINATING terms.
     *
     * plainto_tsquery conjoins every token, so "Que disent les pièces au sujet du 01.01.1976 ?"
     * becomes 'disent' & 'le' & 'piec' & 'sujet' & '01.01.1976' and matches only a chunk holding all
     * five — which a question-shaped query essentially never finds. Three chunks contain that literal
     * date and the conjunctive query returned none of them.
     *
     * Disjoining everything instead was tried and was worse, because ts_rank has no notion of term
     * rarity: "pièces" matches 222 chunks and floats them above the 3 that matter. Measured on a
     * 30-case retrieval evaluation:
     *   conjunctive                       17/30
     *   disjunctive everywhere            13/30
     *   conjunctive, disjunctive on empty 13/30
     *
     * So frequency decides. One indexed query gives the corpus frequency of each term (~7 ms over
     * 12766 chunks), the common ones are dropped, and what remains is disjoined. That is inverse
     * document frequency used as a FILTER rather than as a ranking weight — the part Postgres can do
     * cheaply, since an IDF-weighted ORDER BY would have to score every matching row.
     *
     * When nothing is discriminating enough the sparse half is SKIPPED rather than relaxed. That is
     * the lesson from the 13/30 runs: contributing nothing to the fusion beats contributing a weak
     * ranking, because weak lexical hits displace good dense hits in the top k.
     */
    const dfRes = await this.pg.query<{ term: string; df: string }>(
      `WITH terms AS (
         SELECT DISTINCT unnest(
           regexp_split_to_array(plainto_tsquery('french', $3)::text, ' & ')
           || regexp_split_to_array(plainto_tsquery('dutch', $3)::text, ' & ')
         ) AS term
       )
       SELECT t.term,
              (SELECT count(*) FROM lex_document_chunks c
                WHERE c.workspace_id = $1 AND c.owner_email = $2
                  AND ${tsv} @@ t.term::tsquery) AS df
       FROM terms t
       WHERE t.term <> ''`,
      [workspaceId, ownerEmail, query]
    );

    const corpusSize = await this.pg.query<{ n: string }>(
      `SELECT count(*) AS n FROM lex_document_chunks
       WHERE workspace_id = $1 AND owner_email = $2`,
      [workspaceId, ownerEmail]
    );

    const { tsquery: sparseQuery } = discriminatingTerms(
      dfRes.rows.map((r) => ({ term: r.term, df: Number(r.df) })),
      Number(corpusSize.rows[0]?.n ?? 0)
    );

    let ftsRows: ChunkRow[] = [];
    if (sparseQuery) {
      const tsq = `$3::tsquery`;
      const res = await this.pg.query<ChunkRow>(
        `SELECT ${select}
         FROM lex_document_chunks c
         JOIN lex_documents d ON d.id = c.document_id
         WHERE ${scope} AND ${tsv} @@ ${tsq}
         ORDER BY ts_rank(${tsv}, ${tsq}) DESC
         LIMIT $4`,
        [
          workspaceId,
          ownerEmail,
          sparseQuery,
          CANDIDATE_LIMIT,
          ...(documentIds ? [documentIds] : [])
        ]
      );
      ftsRows = res.rows;
    }
    const ftsRes = { rows: ftsRows };

    // Fuse the dense + sparse rankings (pure, unit-tested — see rag-fusion.ts).
    return reciprocalRankFusion([vecRes.rows, ftsRes.rows], { topK }).map(
      ({ item: r, score }) => ({
        chunkId: r.id,
        pageId: null,
        pageOrdinal: null,
        pageTextHash: null,
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
