import { Injectable, Logger } from "@nestjs/common";
import {
  findAmounts,
  findDates,
  sqlAmountPattern,
  sqlDatePattern
} from "@packages/types";
import type {
  LexActDate,
  LexActDateSample,
  LexStoryAmount,
  LexStoryPayload
} from "@packages/types";
import { PgService } from "../../shared/pg.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * The case story: the amounts a workspace's documents state, with the sentence each came from.
 *
 * DERIVED ON READ. There is no table, no migration and no model call anywhere in this file. Every
 * figure is found by running the shared money pattern over text already stored in
 * lex_document_chunks, and every figure travels with the literal excerpt it was found in. That is
 * what makes it safe to put in front of a lawyer: nothing here is generated, so nothing here can be
 * fabricated, and there is no verbatim gate to enforce because the quote IS the source text.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY: who paid, and who received. The text states sums; attributing
 * them is reading, and in the disputes this app serves who received what is precisely the contested
 * question. So the view shows the amount, the sentence, the document and the page, and the reading is
 * done on the page — one click away — rather than guessed here.
 */

/** Characters of context kept either side of an amount. About a sentence in a filing. */
const EXCERPT_RADIUS = 120;

/**
 * Chunks read per request. Bounds the work for a corpus far larger than today's: measured, 794 of
 * 12766 chunks in the dev corpus match, so this is ~3x headroom before truncation bites, and when it
 * does the payload says so rather than quietly showing a partial ledger.
 */
const MAX_CHUNKS = 2500;

/**
 * Sightings kept per distinct date. One per document is enough to read the thread; the counts above
 * it say how many exist, so the cap is visible rather than silent.
 */
const SAMPLES_PER_DATE = 4;

interface ChunkRow {
  id: string;
  document_id: string;
  content: string;
  char_start: number | null;
  page_from: number | null;
  page_to: number | null;
  /** The citing document's own year, which is how a two-digit year resolves to a century. */
  document_year: number | null;
}

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);

  constructor(
    private pg: PgService,
    private workspaces: WorkspacesService
  ) {}

  async story(
    ownerEmail: string,
    workspaceId: string
  ): Promise<LexStoryPayload> {
    await this.workspaces.getOrFail(ownerEmail, workspaceId); // ownership + existence

    // One extra row past the cap is how truncation is detected without a second COUNT query.
    const res = await this.pg.query<ChunkRow>(
      `SELECT c.id, c.document_id, c.content, c.char_start, c.page_from, c.page_to,
              date_part('year', d.timeline_date)::int AS document_year
       FROM lex_document_chunks c
       JOIN lex_documents d ON d.id = c.document_id
       WHERE c.workspace_id = $1 AND c.owner_email = $2
         AND d.lifecycle_state = 'active'
         AND d.parse_status NOT IN ('awaiting_upload', 'failed')
         AND (c.content ~* $3 OR c.content ~* $4)
       ORDER BY c.document_id, c.chunk_index
       LIMIT $5`,
      [
        workspaceId,
        ownerEmail,
        sqlAmountPattern(),
        sqlDatePattern(),
        MAX_CHUNKS + 1
      ]
    );

    const truncated = res.rows.length > MAX_CHUNKS;
    const rows = truncated ? res.rows.slice(0, MAX_CHUNKS) : res.rows;

    // Chunks overlap by 600 characters, so an amount near a boundary is found twice. Deduping on the
    // ABSOLUTE offset in the document collapses those two sightings into the one amount they are —
    // deduping on the value instead would wrongly merge two genuinely separate payments of the same
    // sum, which in a ledger would understate the money that moved.
    const seen = new Set<string>();
    const amounts: LexStoryAmount[] = [];

    for (const row of rows) {
      const base = row.char_start ?? 0;
      for (const hit of findAmounts(row.content)) {
        const absoluteStart = base + hit.start;
        const key = `${row.document_id}:${absoluteStart}`;
        if (seen.has(key)) continue;
        seen.add(key);

        amounts.push({
          documentId: row.document_id,
          chunkId: row.id,
          value: hit.value,
          currency: hit.currency,
          raw: hit.raw,
          excerpt: excerptAround(row.content, hit.start, hit.end),
          charStart: absoluteStart,
          charEnd: base + hit.end,
          pageFrom: row.page_from,
          pageTo: row.page_to
        });
      }
    }

    // ── Dates written in the text ────────────────────────────────────────────────────────
    // Aggregated by date rather than listed: 3089 sightings across 625 distinct dates on the real
    // corpus, and a flat list of 3089 rows is the wall this view exists to replace. What carries the
    // meaning is how many separate documents state a date — one filing repeating a date is rhetoric,
    // twelve filings citing 27 May 1998 is the death the whole succession turns on.
    const byDate = new Map<
      string,
      {
        mentionCount: number;
        yearInferred: boolean;
        byDocument: Map<string, LexActDateSample>;
      }
    >();

    for (const row of rows) {
      const seenHere = new Set<string>();
      for (const hit of findDates(row.content, {
        referenceYear: row.document_year ?? undefined
      })) {
        const entry = byDate.get(hit.iso) ?? {
          mentionCount: 0,
          yearInferred: false,
          byDocument: new Map<string, LexActDateSample>()
        };
        // Overlapping chunks restate the same sighting; count it once per chunk position.
        const positionKey = `${row.id}:${hit.start}`;
        if (!seenHere.has(positionKey)) {
          seenHere.add(positionKey);
          entry.mentionCount += 1;
        }
        entry.yearInferred = entry.yearInferred || hit.yearInferred;
        if (!entry.byDocument.has(row.document_id))
          entry.byDocument.set(row.document_id, {
            documentId: row.document_id,
            raw: hit.raw,
            excerpt: excerptAround(row.content, hit.start, hit.end),
            chunkId: row.id,
            pageFrom: row.page_from
          });
        byDate.set(hit.iso, entry);
      }
    }

    const actDates: LexActDate[] = [...byDate.entries()]
      .map(([iso, entry]) => ({
        iso,
        documentCount: entry.byDocument.size,
        mentionCount: entry.mentionCount,
        yearInferred: entry.yearInferred,
        samples: [...entry.byDocument.values()].slice(0, SAMPLES_PER_DATE)
      }))
      // Most-cited first: how many filings invoke a date is the only weight available without
      // reading it, and it is a good one.
      .sort(
        (a, b) =>
          b.documentCount - a.documentCount ||
          b.mentionCount - a.mentionCount ||
          (a.iso < b.iso ? -1 : 1)
      );

    // Document order, then position — the order the money appears when reading the file.
    amounts.sort(
      (a, b) =>
        (a.documentId < b.documentId
          ? -1
          : a.documentId > b.documentId
            ? 1
            : 0) || a.charStart - b.charStart
    );

    this.logger.log(
      JSON.stringify({
        action: "lexStoryRead",
        workspaceId,
        chunksScanned: rows.length,
        amounts: amounts.length,
        actDates: actDates.length,
        truncated
      })
    );

    return {
      amounts,
      actDates,
      chunksScanned: rows.length,
      truncated,
      chunkLimit: MAX_CHUNKS
    };
  }
}

/**
 * A window of the chunk's own text around the amount, trimmed to word boundaries.
 *
 * A SUBSTRING, never a rewrite: this string is the evidence the UI shows, so it has to be characters
 * the document actually contains. Whitespace is collapsed for legibility — extracted PDF text is full
 * of stray newlines — and that is the only alteration, applied after the slice so the excerpt is
 * still recognisably the same sentence when she opens the page.
 */
export function excerptAround(
  content: string,
  hitStart: number,
  hitEnd: number
): string {
  const from = Math.max(0, hitStart - EXCERPT_RADIUS);
  const to = Math.min(content.length, hitEnd + EXCERPT_RADIUS);
  let slice = content.slice(from, to);
  // Drop a partial leading/trailing word so the excerpt does not start mid-syllable.
  if (from > 0) slice = slice.replace(/^\S*\s/, "");
  if (to < content.length) slice = slice.replace(/\s\S*$/, "");
  return slice.replace(/\s+/g, " ").trim();
}
