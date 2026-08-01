import { Injectable, Logger } from "@nestjs/common";
import {
  deathTriggerBefore,
  findAmounts,
  findDates,
  LEGAL_TERMS,
  scanLegalText,
  sqlAmountPattern,
  sqlDatePattern,
  termsForSpan
} from "@packages/types";
import type {
  DateMention,
  LexActDate,
  LexActDateSample,
  LexCurrencyCount,
  LexDeathMention,
  LexFact,
  LexFactAmount,
  LexStoryAmount,
  LexStoryCap,
  LexStoryPayload,
  LexUnpairedAmount
} from "@packages/types";
import { PgService } from "../../shared/pg.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * The case story: the dates a workspace's documents write, the sums standing beside them, and the
 * sentence each came from.
 *
 * DERIVED ON READ. There is no table, no migration and no model call anywhere in this file. Every
 * figure, date and word is found by running the shared patterns over text already stored in
 * lex_document_chunks, and every one of them travels with the literal excerpt it was found in. That is
 * what makes it safe to put in front of a lawyer: nothing here is generated, so nothing here can be
 * fabricated, and there is no verbatim gate to enforce because the quote IS the source text.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY: who paid, and who received. The text states sums; attributing
 * them is reading, and in the disputes this app serves who received what is precisely the contested
 * question. It also never says that a sum and a date belong to the same transaction, that a liberality
 * is rapportable, or which régime governs — the payload reports adjacency and counts, and the reading
 * is done on the page, one click away.
 *
 * ONE PASS. Every detector runs inside the single loop over the prefiltered chunks below. Folding the
 * corpus is the expensive half of the work, so the vocabulary scan, the exhibit references, the dates,
 * the amounts and the date×amount join all read the same rows in the same iteration; adding a second
 * loop per detector would multiply a ~200 ms read by the number of things it looks for.
 */

/** Characters of context kept either side of a hit. About a sentence in a filing. */
const EXCERPT_RADIUS = 120;

/**
 * Chunks read per request. Bounds the work for a corpus far larger than today's.
 *
 * Raised from 2500 once the registry became date-anchored: the date prefilter alone matches thousands
 * of chunks, and a silently truncated ledger is the worst failure this read can produce. When the cap
 * does bite the payload says so, and the view is required to say so at the top of the page.
 */
const MAX_CHUNKS = 15000;

/**
 * Sightings kept per distinct date. One per document is enough to read the thread; the counts above
 * it say how many exist, so the cap is visible rather than silent.
 */
const SAMPLES_PER_DATE = 4;

/**
 * Rows of the registry returned. Dead on today's corpus (608 distinct dates) and alive at ten times
 * its size; `caps.facts` reports what it hid.
 */
const MAX_FACTS = 2000;

/** Distinct sums joined to one date. Sorted best-corroborated first, so a cut drops the weakest. */
const AMOUNTS_PER_FACT = 12;

/** Death mentions returned. The trigger pattern is strict enough that this has never fired. */
const MAX_DEATH_MENTIONS = 20;

/** Distinct unpaired sums listed in the footer's browser. */
const MAX_UNPAIRED_AMOUNTS = 400;

/**
 * How close a date and an amount must be to be reported as standing together.
 *
 * About half a clause. Measured on the real corpus this radius plus the mutual-nearest rule below
 * yields 406 pairs over 608 dates — sparse on purpose. Widening it starts joining a date in one
 * sentence to a figure in the next, which would be an assertion rather than an observation.
 */
const JOIN_RADIUS = 40;

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

/** Position of each term in the shared vocabulary, so merged badge lists render in table order. */
const TERM_ORDER = new Map(LEGAL_TERMS.map((term, index) => [term.id, index]));

interface FactAmountEntry {
  value: number;
  currency: string;
  raw: string;
  excerpt: string;
  documentId: string;
  chunkId: string;
  pageFrom: number | null;
  documents: Set<string>;
}

interface FactEntry {
  mentionCount: number;
  yearInferred: boolean;
  byDocument: Map<string, LexActDateSample>;
  notions: Set<string>;
  qualifications: Set<string>;
  milestones: Set<string>;
  /** Keyed on the folded reference so "annexe 13" written two ways counts once; value is the literal. */
  refs: Map<string, string>;
  amounts: Map<string, FactAmountEntry>;
}

interface SumEntry {
  value: number;
  currency: string;
  raw: string;
  excerpt: string;
  documentId: string;
  chunkId: string;
  pageFrom: number | null;
  documents: Set<string>;
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

    // Both statements at once: the document list depends on nothing the scan produces, so serialising
    // them would buy a second round trip for nothing.
    // One extra chunk past the cap is how truncation is detected without a COUNT query.
    const [res, inScopeDocumentIds] = await Promise.all([
      this.pg.query<ChunkRow>(
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
      ),
      this.inScopeDocumentIds(ownerEmail, workspaceId)
    ]);

    const truncated = res.rows.length > MAX_CHUNKS;
    const rows = truncated ? res.rows.slice(0, MAX_CHUNKS) : res.rows;

    // Chunks overlap by 600 characters, so a hit near a boundary is found twice. Deduping on the
    // ABSOLUTE offset in the document collapses those two sightings into the one they are — deduping
    // on the value instead would wrongly merge two genuinely separate payments of the same sum, which
    // in a ledger would understate the money that moved.
    const seenAmounts = new Set<string>();
    const amounts: LexStoryAmount[] = [];

    // ── Dates written in the text ────────────────────────────────────────────────────────
    // Aggregated by date rather than listed: 3089 sightings across ~600 distinct dates on the real
    // corpus, and a flat list of 3089 rows is the wall this view exists to replace. What carries the
    // meaning is how many separate documents state a date — one filing repeating a date is rhetoric,
    // twelve filings citing 27 May 1998 is the death the whole succession turns on.
    const byDate = new Map<string, FactEntry>();
    const deaths = new Map<string, FactEntry>();

    /** Every distinct (currency, value), so the footer can name the sums the registry cannot show. */
    const bySum = new Map<string, SumEntry>();
    /** The subset of those that stand beside a date somewhere. */
    const pairedSums = new Set<string>();
    const byCurrency = new Map<
      string,
      { mentionCount: number; documents: Set<string> }
    >();
    /** Documents that put at least one date into the registry — the complement is the separate pile. */
    const datedDocuments = new Set<string>();

    for (const row of rows) {
      const base = row.char_start ?? 0;
      const amountHits = findAmounts(row.content);
      const dateHits = findDates(row.content, {
        referenceYear: row.document_year ?? undefined
      });

      for (const hit of amountHits) {
        const absoluteStart = base + hit.start;
        const key = `${row.document_id}:${absoluteStart}`;
        if (seenAmounts.has(key)) continue;
        seenAmounts.add(key);

        const excerpt = excerptAround(row.content, hit.start, hit.end);
        amounts.push({
          documentId: row.document_id,
          chunkId: row.id,
          value: hit.value,
          currency: hit.currency,
          raw: hit.raw,
          excerpt,
          charStart: absoluteStart,
          charEnd: base + hit.end,
          pageFrom: row.page_from,
          pageTo: row.page_to
        });

        const currency = byCurrency.get(hit.currency) ?? {
          mentionCount: 0,
          documents: new Set<string>()
        };
        currency.mentionCount += 1;
        currency.documents.add(row.document_id);
        byCurrency.set(hit.currency, currency);

        const sumKey = sumKeyOf(hit.currency, hit.value);
        const sum = bySum.get(sumKey) ?? {
          value: hit.value,
          currency: hit.currency,
          raw: hit.raw,
          excerpt,
          documentId: row.document_id,
          chunkId: row.id,
          pageFrom: row.page_from,
          documents: new Set<string>()
        };
        sum.documents.add(row.document_id);
        bySum.set(sumKey, sum);
      }

      if (dateHits.length === 0) continue;
      datedDocuments.add(row.document_id);

      // The vocabulary and the exhibit references, read out of the SAME characters the dates were
      // found in and folded once for the whole chunk. Skipped entirely when the chunk has no date,
      // because a term with no date to attach to has nowhere to be displayed.
      const { terms, refs } = scanLegalText(row.content);
      // Mutual nearest: the join is only reported when each side is the other's closest neighbour.
      // Computed per chunk, over hits already in memory.
      const nearestAmountOfDate = dateHits.map((hit) =>
        nearestSpan(amountHits, hit)
      );
      const nearestDateOfAmount = amountHits.map((hit) =>
        nearestSpan(dateHits, hit)
      );

      const seenHere = new Set<string>();
      for (const [index, hit] of dateHits.entries()) {
        const entry = ensureEntry(byDate, hit.iso);
        // Overlapping chunks restate the same sighting; count it once per chunk position.
        const positionKey = `${row.id}:${hit.start}`;
        const firstSightingHere = !seenHere.has(positionKey);
        if (firstSightingHere) {
          seenHere.add(positionKey);
          entry.mentionCount += 1;
        }
        entry.yearInferred = entry.yearInferred || hit.yearInferred;
        addSample(entry, row, hit);

        const context = termsForSpan(terms, refs, hit.start, hit.end);
        for (const id of context.notions) entry.notions.add(id);
        for (const id of context.qualifications) entry.qualifications.add(id);
        for (const id of context.milestones) entry.milestones.add(id);
        for (const ref of context.refs)
          if (!entry.refs.has(foldRef(ref))) entry.refs.set(foldRef(ref), ref);

        const amountIndex = nearestAmountOfDate[index];
        if (
          amountIndex >= 0 &&
          nearestDateOfAmount[amountIndex] === index &&
          spanGap(amountHits[amountIndex], hit) <= JOIN_RADIUS
        ) {
          const amountHit = amountHits[amountIndex];
          const sumKey = sumKeyOf(amountHit.currency, amountHit.value);
          pairedSums.add(sumKey);
          const joined = entry.amounts.get(sumKey) ?? {
            value: amountHit.value,
            currency: amountHit.currency,
            raw: amountHit.raw,
            // The window is taken around the DATE and the amount together, so the excerpt shows the
            // adjacency the pair is claiming rather than one half of it.
            excerpt: excerptAround(
              row.content,
              Math.min(hit.start, amountHit.start),
              Math.max(hit.end, amountHit.end)
            ),
            documentId: row.document_id,
            chunkId: row.id,
            pageFrom: row.page_from,
            documents: new Set<string>()
          };
          joined.documents.add(row.document_id);
          entry.amounts.set(sumKey, joined);
        }

        // The death anchor, read only from the characters immediately before the date. A date is
        // recorded here in addition to — never instead of — its registry row.
        if (deathTriggerBefore(row.content, hit.start)) {
          const death = ensureEntry(deaths, hit.iso);
          if (firstSightingHere) death.mentionCount += 1;
          death.yearInferred = death.yearInferred || hit.yearInferred;
          addSample(death, row, hit);
        }
      }
    }

    const facts: LexFact[] = [...byDate.entries()]
      .map(([iso, entry]) => {
        const joined = [...entry.amounts.values()]
          .map(
            (amount): LexFactAmount => ({
              value: amount.value,
              currency: amount.currency,
              raw: amount.raw,
              documentCount: amount.documents.size,
              excerpt: amount.excerpt,
              documentId: amount.documentId,
              chunkId: amount.chunkId,
              pageFrom: amount.pageFrom
            })
          )
          .sort(
            (a, b) =>
              b.documentCount - a.documentCount ||
              Math.abs(b.value) - Math.abs(a.value) ||
              compare(a.currency, b.currency)
          );
        return {
          iso,
          documentCount: entry.byDocument.size,
          mentionCount: entry.mentionCount,
          yearInferred: entry.yearInferred,
          samples: [...entry.byDocument.values()].slice(0, SAMPLES_PER_DATE),
          amounts: joined.slice(0, AMOUNTS_PER_FACT),
          amountCount: joined.length,
          notions: inTableOrder(entry.notions),
          qualifications: inTableOrder(entry.qualifications),
          milestones: inTableOrder(entry.milestones),
          refs: [...entry.refs.values()]
        };
      })
      // CHRONOLOGICAL. The registry is a ledger, not a ranking: the reading task is a file that runs
      // over decades, and the weight of each row is printed on it as a document count.
      .sort((a, b) => compare(a.iso, b.iso));

    // The existing, most-cited-first view. Kept as its own list rather than derived by the client, so
    // the current page keeps working unchanged while the registry lands beside it.
    const actDates: LexActDate[] = facts
      .map((fact) => ({
        iso: fact.iso,
        documentCount: fact.documentCount,
        mentionCount: fact.mentionCount,
        yearInferred: fact.yearInferred,
        samples: fact.samples
      }))
      // Most-cited first: how many filings invoke a date is the only weight available without
      // reading it, and it is a good one.
      .sort(
        (a, b) =>
          b.documentCount - a.documentCount ||
          b.mentionCount - a.mentionCount ||
          compare(a.iso, b.iso)
      );

    const deathMentions: LexDeathMention[] = [...deaths.entries()]
      .map(([iso, entry]) => ({
        iso,
        documentCount: entry.byDocument.size,
        mentionCount: entry.mentionCount,
        yearInferred: entry.yearInferred,
        samples: [...entry.byDocument.values()].slice(0, SAMPLES_PER_DATE)
      }))
      .sort(
        (a, b) => b.documentCount - a.documentCount || compare(a.iso, b.iso)
      );

    const unpaired: LexUnpairedAmount[] = [...bySum.entries()]
      .filter(([key]) => !pairedSums.has(key))
      .map(([, sum]) => ({
        value: sum.value,
        currency: sum.currency,
        raw: sum.raw,
        documentCount: sum.documents.size,
        excerpt: sum.excerpt,
        documentId: sum.documentId,
        chunkId: sum.chunkId,
        pageFrom: sum.pageFrom
      }))
      .sort(
        (a, b) =>
          b.documentCount - a.documentCount ||
          Math.abs(b.value) - Math.abs(a.value) ||
          compare(a.currency, b.currency)
      );

    const amountCensus: LexCurrencyCount[] = [...byCurrency.entries()]
      .map(([currency, count]) => ({
        currency,
        mentionCount: count.mentionCount,
        documentCount: count.documents.size
      }))
      .sort(
        (a, b) =>
          b.mentionCount - a.mentionCount || compare(a.currency, b.currency)
      );

    // Document order, then position — the order the money appears when reading the file.
    amounts.sort(
      (a, b) => compare(a.documentId, b.documentId) || a.charStart - b.charStart
    );

    const undatedDocumentIds = inScopeDocumentIds.filter(
      (id) => !datedDocuments.has(id)
    );

    this.logger.log(
      JSON.stringify({
        action: "lexStoryRead",
        workspaceId,
        chunksScanned: rows.length,
        amounts: amounts.length,
        facts: facts.length,
        deathMentions: deathMentions.length,
        unpairedAmounts: unpaired.length,
        undatedDocuments: undatedDocumentIds.length,
        truncated
      })
    );

    return {
      amounts,
      actDates,
      facts: facts.slice(0, MAX_FACTS),
      deathMentions: deathMentions.slice(0, MAX_DEATH_MENTIONS),
      unpairedAmounts: unpaired.slice(0, MAX_UNPAIRED_AMOUNTS),
      distinctAmountCount: bySum.size,
      amountCensus,
      undatedDocumentIds,
      caps: {
        facts: cap(facts.length, MAX_FACTS),
        deathMentions: cap(deathMentions.length, MAX_DEATH_MENTIONS),
        unpairedAmounts: cap(unpaired.length, MAX_UNPAIRED_AMOUNTS)
      },
      chunksScanned: rows.length,
      truncated,
      chunkLimit: MAX_CHUNKS
    };
  }

  /**
   * The documents the registry is allowed to see, whether or not any chunk of them matched.
   *
   * A second statement rather than a second scan: it reads ~56 primary-key rows and no text at all.
   * It cannot be folded into the chunk query, and that is the point — a document with no date and no
   * amount anywhere produces no chunk row, so it is invisible from there. Those are exactly the
   * documents the footer has to name.
   */
  private async inScopeDocumentIds(
    ownerEmail: string,
    workspaceId: string
  ): Promise<string[]> {
    const res = await this.pg.query<{ id: string }>(
      `SELECT id FROM lex_documents
       WHERE workspace_id = $1 AND owner_email = $2
         AND lifecycle_state = 'active'
         AND parse_status NOT IN ('awaiting_upload', 'failed')
       ORDER BY id`,
      [workspaceId, ownerEmail]
    );
    return res.rows.map((row) => row.id);
  }
}

function cap(total: number, limit: number): LexStoryCap {
  return { returned: Math.min(total, limit), total, limit };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sumKeyOf(currency: string, value: number): string {
  return `${currency}|${value}`;
}

/** Whitespace-collapsed and lowercased, so "annexe 13" and "Annexe  13" are one reference. */
function foldRef(raw: string): string {
  return raw.replace(/\s+/g, " ").toLowerCase();
}

function ensureEntry(map: Map<string, FactEntry>, iso: string): FactEntry {
  const existing = map.get(iso);
  if (existing) return existing;
  const created: FactEntry = {
    mentionCount: 0,
    yearInferred: false,
    byDocument: new Map(),
    notions: new Set(),
    qualifications: new Set(),
    milestones: new Set(),
    refs: new Map(),
    amounts: new Map()
  };
  map.set(iso, created);
  return created;
}

function addSample(entry: FactEntry, row: ChunkRow, hit: DateMention): void {
  if (entry.byDocument.has(row.document_id)) return;
  entry.byDocument.set(row.document_id, {
    documentId: row.document_id,
    raw: hit.raw,
    excerpt: excerptAround(row.content, hit.start, hit.end),
    chunkId: row.id,
    pageFrom: row.page_from
  });
}

function inTableOrder(ids: Set<string>): string[] {
  return [...ids].sort(
    (a, b) => (TERM_ORDER.get(a) ?? 0) - (TERM_ORDER.get(b) ?? 0)
  );
}

interface Span {
  start: number;
  end: number;
}

/** Characters between two spans, or 0 when they overlap. */
function spanGap(a: Span, b: Span): number {
  if (a.start < b.end && b.start < a.end) return 0;
  return a.start >= b.end ? a.start - b.end : b.start - a.end;
}

/**
 * Index of the span closest to `to`, or -1 when there is none.
 *
 * Ties go to the EARLIER span, which is what makes the join deterministic: both hit lists arrive in
 * ascending start order, so the same chunk always produces the same pairing regardless of how the
 * loop is entered.
 */
function nearestSpan(spans: readonly Span[], to: Span): number {
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const [index, span] of spans.entries()) {
    const gap = spanGap(span, to);
    if (gap < bestGap) {
      bestGap = gap;
      best = index;
    }
  }
  return best;
}

/**
 * A window of the chunk's own text around the hit, trimmed to word boundaries.
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

/**
 * The bounds, exported so the spec asserts the numbers rather than restating them.
 *
 * Each one is a claim about a real corpus, and a spec that hardcodes its own copy of a limit stops
 * failing the day the limit changes — which is the day it most needs to.
 */
export const STORY_JOIN_RADIUS = JOIN_RADIUS;
export const STORY_MAX_CHUNKS = MAX_CHUNKS;
export const STORY_MAX_FACTS = MAX_FACTS;
export const STORY_AMOUNTS_PER_FACT = AMOUNTS_PER_FACT;
export const STORY_MAX_UNPAIRED_AMOUNTS = MAX_UNPAIRED_AMOUNTS;
export const STORY_MAX_DEATH_MENTIONS = MAX_DEATH_MENTIONS;
export const STORY_SAMPLES_PER_DATE = SAMPLES_PER_DATE;
