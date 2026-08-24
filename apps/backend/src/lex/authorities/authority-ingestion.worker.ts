import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import type { LexAuthorityStatus, LexLanguage } from "@packages/types";
import { z } from "zod";
import { ConfigService } from "../../config/config.service";
import { LexS3Service } from "../../shared/lex-s3.service";
import { OpenAiService } from "../../shared/openai.service";
import { PgService } from "../../shared/pg.service";
import { estimateTokens } from "../../shared/tokens";
import { buildFullText, sanitizeForStorage } from "../documents/chunker";
import { parseDocument } from "../documents/document-parser";
import { outputLanguageInstruction } from "../settings/language-instruction";
import { SettingsService } from "../settings/settings.service";
import {
  chunkAuthority,
  countArticles,
  stripArticleHeading,
  type AuthorityChunk
} from "./authority-chunker";

const POLL_INTERVAL_MS = 5000;
const EMBED_BATCH = 64;
/**
 * Concurrency 1, against the document worker's 3. One authority is a whole code: hundreds of
 * embedding batches and dozens of digest calls, all on the box that also serves the Campaigns
 * API. Running them one at a time means uploading a 700-page code slows nothing down but itself.
 */
const POOL_SIZE = 1;

// ── Digest budget ─────────────────────────────────────────────────────────────────────
// The digest is injected into EVERY chat turn for every enabled authority, so its size is a
// permanent tax on the context window — hence a hard ceiling rather than a target.
//
// Arithmetic: 1500 tokens x 3.4 chars/token ≈ 5100 characters. At DIGEST_LINE_MAX_CHARS = 110
// that is ~46 lines, so 45 total lines (the coverage line plus 40 map lines asked of the model,
// with slack for a model that returns a few more) fits with room to spare. Tokens are ESTIMATED
// at the shared CHARS_PER_TOKEN estimate — the same one ContextAssembler budgets prompts with,
// which is what this competes against. See shared/tokens.ts for why it is an estimate.
const DIGEST_MAX_TOKENS = 1500;
const DIGEST_MAX_LINES = 45;
const DIGEST_MAP_LINES = 40;
const DIGEST_LINE_MAX_CHARS = 110;
const TRUNCATION_MARKER = "… (map truncated; later articles remain searchable)";

/**
 * Batching for the map step. No single call ever sees the whole code: it is summarised in
 * batches of articles, then the batch results are compacted. DIGEST_MAX_BATCHES caps the number
 * of model calls per authority (batches grow instead), so ingesting a code of 10 000 articles
 * costs the same handful of calls as one of 1000.
 */
const DIGEST_MIN_BATCH = 40;
const DIGEST_MAX_BATCHES = 40;
const BATCH_MAX_LINES = 6;
const BATCH_INPUT_MAX_CHARS = 24000;
const MIN_SUBJECT_CHARS = 24;
const MAP_ENTRY_SUBJECT_CHARS = 140;
/** Input to the digest of an authority with no articles at all (a judgment). */
const UNNUMBERED_INPUT_CHARS = 12000;

interface JobRow {
  id: string;
  authority_id: string;
}

interface AuthorityRow {
  id: string;
  owner_email: string;
  title: string;
  filename: string;
  content_type: string | null;
  s3_key: string;
}

/** One article's line in the map skeleton: its label and the opening words of its text. */
export interface ArticleMapEntry {
  label: string;
  subject: string;
}

/**
 * Named alias for the shared estimate, kept because `digest_tokens` is the one token figure a user
 * actually sees (LexAuthorities sums it into "tokens added to every question") and the call sites
 * read better for saying which quantity they mean.
 */
export const estimateDigestTokens = estimateTokens;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The map skeleton, derived from the chunks with no model involved: one entry per distinct
 * article, in reading order, carrying the opening words of its text.
 *
 * First occurrence wins. In a code that opens with a table of contents that means the TOC line
 * supplies the subject — which is what a TOC line is — and the substantive text of the same
 * article is still chunked, embedded and retrievable under the same label.
 */
export function articleMapEntries(chunks: AuthorityChunk[]): ArticleMapEntry[] {
  const seen = new Set<string>();
  const out: ArticleMapEntry[] = [];
  for (const c of chunks) {
    if (!c.articleLabel || seen.has(c.articleLabel)) continue;
    seen.add(c.articleLabel);
    out.push({
      label: c.articleLabel,
      subject: collapse(stripArticleHeading(c.content)).slice(
        0,
        MAP_ENTRY_SUBJECT_CHARS
      )
    });
  }
  return out;
}

/** "Art. 371" + "Art. 378" → "Art. 371–378". */
function spanLabel(first: string, last: string): string {
  if (first === last) return first;
  return `${first}–${last.replace(/^Art\.[ \t]*/, "")}`;
}

/**
 * The one deterministic, free line: what this authority covers and how much of it there is. Kept
 * symbolic rather than worded so it reads the same whatever language the digest is written in,
 * and first in the digest so the model can rule an authority out without reading the map.
 */
export function coverageLine(entries: ArticleMapEntry[]): string {
  if (entries.length === 0) return "";
  const span = spanLabel(entries[0].label, entries[entries.length - 1].label);
  return `[${span} · ${entries.length} art.]`;
}

/**
 * The map we can build with NO model at all: bucket consecutive articles into at most `maxLines`
 * groups and label each group with its first article's opening words.
 *
 * This is the fallback when a model call fails, per batch, so an embedding-era outage degrades
 * the digest's prose instead of failing an ingest that has already paid for its embeddings. The
 * article numbers — the part a citation depends on — are exact either way.
 */
export function bucketLines(
  entries: ArticleMapEntry[],
  maxLines: number
): string[] {
  if (entries.length === 0) return [];
  const perBucket = Math.ceil(entries.length / maxLines);
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i += perBucket) {
    const bucket = entries.slice(i, i + perBucket);
    const span = spanLabel(bucket[0].label, bucket[bucket.length - 1].label);
    lines.push(`${span} — ${bucket[0].subject}`);
  }
  return lines;
}

/**
 * Splits a run of prose into digest-sized lines. Used by the no-article fallback, where the
 * opening of the text IS the best index we can produce without a model.
 */
export function proseLines(text: string): string[] {
  const collapsed = collapse(text);
  const out: string[] = [];
  for (
    let i = 0;
    i < collapsed.length && out.length < DIGEST_MAP_LINES;
    i += DIGEST_LINE_MAX_CHARS
  ) {
    out.push(collapsed.slice(i, i + DIGEST_LINE_MAX_CHARS));
  }
  return out;
}

/** Trims, collapses, caps and de-duplicates whatever the model returned as map lines. */
export function normalizeDigestLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = collapse(sanitizeForStorage(raw)).slice(
      0,
      DIGEST_LINE_MAX_CHARS
    );
    if (line.length === 0 || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/**
 * Enforces the token ceiling deterministically: keep the first DIGEST_MAX_LINES lines, then drop
 * from the END until the estimate fits, and say so when anything was dropped.
 *
 * Dropping the tail rather than sampling keeps the result reproducible for a given input, and the
 * coverage line (which is first) survives — so the model still knows the authority runs past
 * where the map stops, and retrieval reaches those articles regardless.
 *
 * The marker's own length is priced in while measuring, so the ceiling holds for the string
 * actually returned rather than for the one before the marker was appended.
 */
export function capDigest(lines: string[]): string {
  const join = (kept: string[], truncated: boolean): string =>
    (truncated ? [...kept, TRUNCATION_MARKER] : kept).join("\n");

  let kept = lines.slice(0, DIGEST_MAX_LINES);
  let truncated = kept.length < lines.length;
  while (
    kept.length > 0 &&
    estimateDigestTokens(join(kept, true)) > DIGEST_MAX_TOKENS
  ) {
    kept = kept.slice(0, -1);
    truncated = true;
  }
  return join(kept, truncated);
}

const mapBatchSchema = z.object({
  lines: z.array(z.string()).optional(),
  language: z.string().nullable().optional()
});

/**
 * In-process AUTHORITY ingestion worker. Polls lex_authority_jobs, claims jobs with
 * SELECT ... FOR UPDATE SKIP LOCKED, and runs parse → chunk → embed → digest on the single EC2.
 *
 * Separate from IngestionWorker rather than a mode on it: lex_ingestion_jobs.document_id has a
 * NOT NULL FK to lex_documents, so an authority cannot be queued there at all — and the two want
 * different concurrency (see POOL_SIZE). Inert unless Lex is configured (DATABASE_URL present),
 * so Campaigns-only deploys never start it.
 */
@Injectable()
export class AuthorityIngestionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthorityIngestionWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private pg: PgService,
    private openai: OpenAiService,
    private s3: LexS3Service,
    private settings: SettingsService,
    private config: ConfigService
  ) {}

  onModuleInit(): void {
    if (!this.config.get("DATABASE_URL")) {
      this.logger.log(
        "Lex authority ingestion worker idle (DATABASE_URL not configured)"
      );
      return;
    }
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.all(
        Array.from({ length: POOL_SIZE }, () => this.drainLoop())
      );
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "lexAuthorityIngestTick",
          error: String(err)
        })
      );
    } finally {
      this.running = false;
    }
  }

  private async drainLoop(): Promise<void> {
    while (await this.processOne()) {
      /* keep draining */
    }
  }

  /** Claims and processes one queued job. Returns false when the queue is empty. */
  private async processOne(): Promise<boolean> {
    const claim = await this.pg.query<JobRow>(
      `UPDATE lex_authority_jobs
         SET status = 'running', attempts = attempts + 1, locked_at = now(), updated_at = now()
       WHERE id = (
         SELECT id FROM lex_authority_jobs
         WHERE status = 'queued'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id, authority_id`
    );
    if (claim.rows.length === 0) return false;

    const job = claim.rows[0];
    try {
      await this.runPipeline(job.authority_id);
      await this.pg.query(
        `UPDATE lex_authority_jobs SET status = 'done', updated_at = now() WHERE id = $1`,
        [job.id]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "lexAuthorityIngestFailed",
          authorityId: job.authority_id,
          error: msg
        })
      );
      await this.pg.query(
        `UPDATE lex_authority_jobs SET status = 'failed', last_error = $2, updated_at = now()
         WHERE id = $1`,
        [job.id, msg]
      );
      await this.setStatus(job.authority_id, "failed", msg);
    }
    return true;
  }

  private async setStatus(
    authorityId: string,
    status: LexAuthorityStatus,
    error?: string
  ): Promise<void> {
    await this.pg.query(
      `UPDATE lex_authorities SET status = $2, error = $3, updated_at = now() WHERE id = $1`,
      [authorityId, status, error ?? null]
    );
  }

  private async runPipeline(authorityId: string): Promise<void> {
    const res = await this.pg.query<AuthorityRow>(
      `SELECT id, owner_email, title, filename, content_type, s3_key
       FROM lex_authorities WHERE id = $1`,
      [authorityId]
    );
    if (res.rows.length === 0) throw new Error("authority row vanished");
    const authority = res.rows[0];

    // 1. Text. Sanitised HERE, before buildFullText, because sanitising later would move the
    //    text under the char offsets the chunks are stored with — and it is what stops a NUL byte
    //    from aborting the chunk INSERT with `invalid byte sequence for encoding "UTF8": 0x00`.
    await this.setStatus(authorityId, "parsing");
    const { body } = await this.s3.get(authority.s3_key);
    const parsed = await parseDocument(
      body,
      authority.content_type ?? "",
      authority.filename
    );
    if (parsed.needsTranscription) {
      throw new Error(
        `"${authority.filename}" is audio. An authority is a text of law — upload the PDF or the text of the statute.`
      );
    }
    // No OCR leg here, deliberately: OCR of a 700-page code is expensive and its article numbers
    // are exactly what OCR gets wrong (374 vs 37&, 1er vs ler), which would poison every label.
    // Official codes are published as text PDFs, so the honest answer is to ask for one.
    if (parsed.needsOcr) {
      throw new Error(
        `"${authority.filename}" has no text layer (it looks like a scan). Article numbers read from a scan cannot be trusted as citation anchors — upload a text PDF of this authority.`
      );
    }
    // Visibility on bytes Postgres would have rejected: in a code, a mis-decoded run sits
    // somewhere in an article whose number is now the anchor of a citation.
    if (parsed.droppedChars > 0) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexAuthorityTextSanitized",
          authorityId,
          filename: authority.filename,
          droppedChars: parsed.droppedChars
        })
      );
    }
    const pages = parsed.pages.map(sanitizeForStorage);

    await this.setStatus(authorityId, "chunking");
    const { fullText, pageRanges } = buildFullText(pages);
    if (fullText.trim().length === 0) {
      throw new Error(
        `No text could be extracted from "${authority.filename}".`
      );
    }

    // 2. Article-aware chunking, with the citation-anchor invariant asserted before anything is
    //    stored: a chunk whose offsets do not slice back to its own text would deep-link a
    //    citation to the wrong passage of the code.
    const chunks = chunkAuthority(fullText, pageRanges);
    for (const c of chunks) {
      if (fullText.slice(c.charStart, c.charEnd) !== c.content) {
        throw new Error(`chunk offset mismatch at index ${c.chunkIndex}`);
      }
    }

    // 3. Embed + store (idempotent: a retry clears the previous chunks first).
    await this.setStatus(authorityId, "embedding");
    await this.pg.query(
      `DELETE FROM lex_authority_chunks WHERE authority_id = $1`,
      [authorityId]
    );
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await this.openai.embed(batch.map((c) => c.content));
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        await this.pg.query(
          `INSERT INTO lex_authority_chunks
             (authority_id, owner_email, chunk_index, article_label, page_from, page_to,
              char_start, char_end, content, token_count, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::halfvec)`,
          [
            authorityId,
            authority.owner_email,
            c.chunkIndex,
            c.articleLabel,
            c.pageFrom,
            c.pageTo,
            c.charStart,
            c.charEnd,
            c.content,
            c.tokenCount,
            `[${vectors[j].join(",")}]`
          ]
        );
      }
    }

    // 4. The digest: the compressed article map that rides along in every chat turn.
    await this.setStatus(authorityId, "digesting");
    const language = await this.settings.languageOf(authority.owner_email);
    const entries = articleMapEntries(chunks);
    const digest = entries.length
      ? await this.buildArticleMap(authority.title, entries, language)
      : await this.digestUnnumbered(authority.title, fullText, language);

    await this.pg.query(
      `UPDATE lex_authorities
         SET status = 'ready', digest = $2, digest_tokens = $3, article_count = $4,
             page_count = $5, language = $6, error = NULL, updated_at = now()
       WHERE id = $1`,
      [
        authorityId,
        digest.digest || null,
        estimateDigestTokens(digest.digest),
        countArticles(chunks),
        parsed.pageCount,
        digest.language
      ]
    );

    this.logger.log(
      JSON.stringify({
        action: "lexAuthorityIngested",
        authorityId,
        chunks: chunks.length,
        articles: countArticles(chunks),
        pages: parsed.pageCount,
        digestTokens: estimateDigestTokens(digest.digest)
      })
    );
  }

  /**
   * Builds the digest hierarchically, so no single model call ever sees the whole code:
   *
   *  1. the skeleton (article label → opening words) is derived from the chunks, free and exact;
   *  2. it is summarised in batches, each producing at most BATCH_MAX_LINES lines that group
   *     CONSECUTIVE articles sharing a subject ("Art. 371–378 — autorité parentale: …");
   *  3. the batch lines — small now — are compacted in one call if they still exceed the budget;
   *  4. the ceiling is enforced deterministically, whatever the model returned.
   *
   * The result is a map, not a summary: the point is not to explain the code, it is to let the
   * model see which article to ask for and then fetch that article's exact text.
   */
  private async buildArticleMap(
    title: string,
    entries: ArticleMapEntry[],
    language: LexLanguage
  ): Promise<{ digest: string; language: string | null }> {
    const size = Math.max(
      DIGEST_MIN_BATCH,
      Math.ceil(entries.length / DIGEST_MAX_BATCHES)
    );
    let lines: string[] = [];
    let detected: string | null = null;

    for (let i = 0; i < entries.length; i += size) {
      const batch = entries.slice(i, i + size);
      try {
        const result = await this.mapBatch(title, batch, language);
        lines.push(...result.lines);
        detected = detected ?? result.language;
      } catch (err) {
        this.logger.warn(
          JSON.stringify({
            level: "warn",
            action: "lexAuthorityDigestBatchFailed",
            title,
            firstArticle: batch[0].label,
            error: String(err)
          })
        );
        lines.push(...bucketLines(batch, BATCH_MAX_LINES));
      }
    }

    lines = normalizeDigestLines(lines);
    if (
      lines.length > DIGEST_MAP_LINES ||
      estimateDigestTokens(lines.join("\n")) > DIGEST_MAX_TOKENS
    ) {
      lines = await this.compact(title, lines, language);
    }

    return {
      digest: capDigest([coverageLine(entries), ...lines]),
      language: detected
    };
  }

  /** One batch of articles → a few grouped map lines. */
  private async mapBatch(
    title: string,
    batch: ArticleMapEntry[],
    language: LexLanguage
  ): Promise<{ lines: string[]; language: string | null }> {
    // The per-article budget is derived from the batch size so a pathologically large code
    // bounds its own prompt instead of the prompt bounding how many articles get indexed —
    // every article still goes in, with less of its text each.
    const perEntry = Math.max(
      MIN_SUBJECT_CHARS,
      Math.floor(BATCH_INPUT_MAX_CHARS / batch.length)
    );
    const raw = await this.openai.complete({
      // hierarchical digest — up to 40 calls per authority.
      fast: true,
      json: true,
      system:
        "You are a legal-knowledge indexer for Belgian-law statutes. You index only what is in front of you and never invent an article number.",
      user:
        `${outputLanguageInstruction(language)}\n\n` +
        `AUTHORITY: ${title}\n` +
        `Articles ${batch[0].label} to ${batch[batch.length - 1].label}, one per line as ` +
        `"<article> :: <opening words>":\n\n` +
        batch
          .map((e) => `${e.label} :: ${e.subject.slice(0, perEntry)}`)
          .join("\n") +
        `\n\nProduce an INDEX of these articles: at most ${BATCH_MAX_LINES} lines, each at most ` +
        `${DIGEST_LINE_MAX_CHARS} characters, formatted "<article or article range> — <subject>". ` +
        `Group CONSECUTIVE articles that share a subject into one range; give an article its own ` +
        `line only when its subject is distinct. Use only article numbers that appear above, ` +
        `written exactly as they appear. This index is how a lawyer decides which article to ` +
        `read in full, so name subjects concretely.\n` +
        `Respond as JSON: {"lines": ["Art. 371–378 — ..."], ` +
        `"language": "the 2-letter code of the language the articles themselves are written in"}`
    });
    const parsed = mapBatchSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error("unusable digest batch response");
    return {
      lines: normalizeDigestLines(parsed.data.lines ?? []),
      language: parsed.data.language ? collapse(parsed.data.language) : null
    };
  }

  /**
   * Second pass over the batch lines when they still exceed the budget. Falls back to the
   * un-compacted lines on failure — capDigest enforces the ceiling either way, so the worst case
   * is a map that stops early rather than a failed ingest.
   */
  private async compact(
    title: string,
    lines: string[],
    language: LexLanguage
  ): Promise<string[]> {
    try {
      const raw = await this.openai.complete({
        // hierarchical digest — up to 40 calls per authority.
        fast: true,
        json: true,
        system:
          "You compress legal indexes. You never invent an article number and never drop the end of the range.",
        user:
          `${outputLanguageInstruction(language)}\n\n` +
          `This index of "${title}" is ${lines.length} lines and must fit in ` +
          `${DIGEST_MAP_LINES}:\n\n${lines.join("\n")}\n\n` +
          `Merge adjacent lines whose subjects belong together until at most ` +
          `${DIGEST_MAP_LINES} lines remain, each at most ${DIGEST_LINE_MAX_CHARS} characters, ` +
          `keeping the format "<article range> — <subject>". The ranges must stay contiguous and ` +
          `must still end at the last article number above: an article that disappears from this ` +
          `map is an article the reader will not know exists.\n` +
          `Respond as JSON: {"lines": [...]}`
      });
      const parsed = mapBatchSchema.safeParse(JSON.parse(raw));
      const compacted = parsed.success
        ? normalizeDigestLines(parsed.data.lines ?? [])
        : [];
      return compacted.length ? compacted : lines;
    } catch (err) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexAuthorityDigestCompactFailed",
          title,
          error: String(err)
        })
      );
      return lines;
    }
  }

  /**
   * The digest of an authority with no articles — a leading judgment, typically. There is no map
   * to build, so the digest states what the decision holds and which passages are worth pulling.
   * Deterministic fallback: the opening of the text, which for a judgment is its header and the
   * question it decides.
   */
  private async digestUnnumbered(
    title: string,
    fullText: string,
    language: LexLanguage
  ): Promise<{ digest: string; language: string | null }> {
    try {
      const raw = await this.openai.complete({
        // hierarchical digest — up to 40 calls per authority.
        fast: true,
        json: true,
        system:
          "You are a legal-knowledge indexer for Belgian-law judgments. You never state a holding the text does not contain.",
        user:
          `${outputLanguageInstruction(language)}\n\n` +
          `AUTHORITY: ${title}\n\n${fullText.slice(0, UNNUMBERED_INPUT_CHARS)}\n\n` +
          `This authority has no numbered articles. Index it in at most ${DIGEST_MAP_LINES} ` +
          `lines of at most ${DIGEST_LINE_MAX_CHARS} characters: what it is, what it holds, and ` +
          `the specific points a lawyer would look up in it. Quote no more than a few words.\n` +
          `Respond as JSON: {"lines": [...], ` +
          `"language": "the 2-letter code of the language this text is written in"}`
      });
      const parsed = mapBatchSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error("unusable digest response");
      const lines = normalizeDigestLines(parsed.data.lines ?? []);
      if (lines.length === 0) throw new Error("empty digest response");
      return {
        digest: capDigest(lines),
        language: parsed.data.language ? collapse(parsed.data.language) : null
      };
    } catch (err) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexAuthorityDigestFallback",
          title,
          error: String(err)
        })
      );
      return { digest: capDigest(proseLines(fullText)), language: null };
    }
  }
}
