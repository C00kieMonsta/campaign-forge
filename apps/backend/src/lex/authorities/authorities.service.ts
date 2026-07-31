import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type {
  LexAuthority,
  LexAuthorityDigest,
  LexAuthorityStatus,
  PresignAuthorityRequest,
  UpdateAuthorityRequest
} from "@packages/types";
import { LexS3Service } from "../../shared/lex-s3.service";
import { OpenAiService } from "../../shared/openai.service";
import { PgService } from "../../shared/pg.service";
import { reciprocalRankFusion } from "../ai/rag-fusion";
import { SettingsService } from "../settings/settings.service";
import { normalizeArticleLabel } from "./authority-chunker";

/** Dense/sparse candidates per leg of the hybrid search, as in RagService. */
const CANDIDATE_LIMIT = 40;

/**
 * Ceiling on chunks returned by an exact article lookup. A question can name several articles,
 * and a long article is stored as several chunks, so this bounds what one lookup can push into
 * the prompt.
 */
const ARTICLE_LOOKUP_LIMIT = 12;

interface AuthorityRow {
  id: string;
  owner_email: string;
  title: string;
  filename: string;
  content_type: string | null;
  size_bytes: string | null;
  s3_key: string;
  status: LexAuthorityStatus;
  language: string | null;
  page_count: number | null;
  article_count: number;
  digest_tokens: number | null;
  enabled: boolean;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Every column mapAuthority needs — `digest` is deliberately excluded: it is a sub-resource
 * (see getDigest) running to several thousand characters, so no authority read or list should
 * carry it.
 */
const AUTHORITY_COLUMNS = `id, owner_email, title, filename, content_type, size_bytes, s3_key,
  status, language, page_count, article_count, digest_tokens, enabled, error, created_at,
  updated_at`;

interface DigestRow {
  id: string;
  digest: string | null;
  digest_tokens: number | null;
  updated_at: Date;
}

interface ArticleChunkRow {
  id: string;
  authority_id: string;
  title: string;
  article_label: string | null;
  page_from: number | null;
  page_to: number | null;
  char_start: number | null;
  char_end: number | null;
  content: string;
  chunk_index: number;
}

/**
 * One reserved authority upload: the row that exists but has no bytes yet, plus the presigned
 * PUT the browser must use. Shaped like LexUploadSlot (documents) — `contentType` is echoed back
 * because S3 validates that the PUT sends exactly the type the URL was signed for.
 */
export interface AuthorityUploadSlot {
  authority: LexAuthority;
  uploadUrl: string;
  contentType: string;
}

/** What every chat turn injects: the always-in-context article map of one enabled authority. */
export interface EnabledAuthorityDigest {
  authorityId: string;
  title: string;
  digest: string;
  digestTokens: number | null;
}

/**
 * A retrieved passage of law. Carries the article label so the citation can name the article
 * rather than a page — see the migration's note on why that is the anchor for a statute.
 */
export interface RetrievedArticle {
  chunkId: string;
  authorityId: string;
  title: string;
  articleLabel: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  charStart: number | null;
  charEnd: number | null;
  content: string;
  score: number;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

export function mapAuthority(r: AuthorityRow): LexAuthority {
  return {
    id: r.id,
    ownerEmail: r.owner_email,
    title: r.title,
    filename: r.filename,
    contentType: r.content_type,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
    s3Key: r.s3_key,
    status: r.status,
    language: r.language,
    pageCount: r.page_count,
    articleCount: r.article_count,
    enabled: r.enabled,
    digestTokens: r.digest_tokens,
    error: r.error,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  };
}

function toRetrieved(r: ArticleChunkRow, score: number): RetrievedArticle {
  return {
    chunkId: r.id,
    authorityId: r.authority_id,
    title: r.title,
    articleLabel: r.article_label,
    pageFrom: r.page_from,
    pageTo: r.page_to,
    charStart: r.char_start,
    charEnd: r.char_end,
    content: r.content,
    score
  };
}

/**
 * Authorities: the law the user has uploaded and which Lex must treat as non-negotiable truth.
 * Owner-scoped (Belgian family law applies to every one of this user's cases), so no query here
 * takes a workspace — see the migration for why they live in their own tables rather than
 * sharing the document ones.
 */
@Injectable()
export class AuthoritiesService {
  private readonly logger = new Logger(AuthoritiesService.name);

  constructor(
    private pg: PgService,
    private s3: LexS3Service,
    private openai: OpenAiService,
    private settings: SettingsService
  ) {}

  /**
   * Step 1 of upload: reserve an authority row per file and hand back a presigned PUT URL.
   *
   * Identical model to documents: the row is created before its bytes exist (status
   * 'awaiting_upload') and the bytes go browser → S3 directly, never through this API. A code is
   * exactly the kind of 40 MB PDF that nginx (10 MB body cap in prod) would refuse.
   */
  async presignUploads(
    ownerEmail: string,
    files: PresignAuthorityRequest["files"]
  ): Promise<{ uploads: AuthorityUploadSlot[] }> {
    // lex_authorities.owner_email has an FK to lex_users(email), and — unlike a document, which
    // is reached through a workspace the user must already own — an authority can be the very
    // first Lex row this account writes. SettingsService.get is the codebase's create-on-first-
    // read for that row.
    await this.settings.get(ownerEmail);

    const uploads: AuthorityUploadSlot[] = [];
    for (const file of files) {
      const id = randomUUID();
      const ext = (file.filename.split(".").pop() || "bin")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 10);
      // No workspace segment (authorities are owner-scoped); the literal "authorities" segment
      // keeps the prefix from ever colliding with a workspace id.
      const key = `lex/${ownerEmail}/authorities/${id}/original.${ext || "bin"}`;
      const contentType = file.contentType || "application/octet-stream";

      const res = await this.pg.query<AuthorityRow>(
        `INSERT INTO lex_authorities
           (id, owner_email, title, filename, content_type, size_bytes, s3_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'awaiting_upload')
         RETURNING ${AUTHORITY_COLUMNS}`,
        [
          id,
          ownerEmail,
          // The title is what the model and the user see in every citation; it defaults to the
          // filename and stays editable, because "CODE-CIVIL-2024-v3.pdf" cites badly.
          file.title?.trim() || file.filename,
          file.filename,
          contentType,
          file.size,
          key
        ]
      );

      uploads.push({
        authority: mapAuthority(res.rows[0]),
        uploadUrl: await this.s3.presignedPutUrl(key, contentType),
        contentType
      });
    }

    return { uploads };
  }

  /**
   * Step 2 of upload: confirm the bytes landed, then queue ingestion.
   *
   * Every object is HEADed rather than trusted: a browser PUT can fail or be abandoned, and
   * queueing a job for an object that is not there would just produce a failed authority. Rows
   * whose object is missing stay 'awaiting_upload' and are reported back as missing.
   */
  async completeUploads(
    ownerEmail: string,
    authorityIds: string[]
  ): Promise<{ authorities: LexAuthority[]; missing: string[] }> {
    const authorities: LexAuthority[] = [];
    const missing: string[] = [];

    for (const id of authorityIds) {
      const found = await this.pg.query<{ s3_key: string }>(
        `SELECT s3_key FROM lex_authorities
         WHERE id = $1 AND owner_email = $2 AND status = 'awaiting_upload'`,
        [id, ownerEmail]
      );
      if (found.rows.length === 0) {
        missing.push(id);
        continue;
      }

      const head = await this.s3.head(found.rows[0].s3_key);
      if (!head) {
        missing.push(id);
        continue;
      }

      const row = await this.pg.withTransaction(async (client) => {
        const res = await client.query<AuthorityRow>(
          `UPDATE lex_authorities
             SET status = 'uploaded', size_bytes = $2, s3_version_id = $3, updated_at = now()
           WHERE id = $1
           RETURNING ${AUTHORITY_COLUMNS}`,
          [id, head.size, head.versionId ?? null]
        );
        await client.query(
          `INSERT INTO lex_authority_jobs (authority_id) VALUES ($1)`,
          [id]
        );
        return res.rows[0];
      });
      authorities.push(mapAuthority(row));
    }

    this.logger.log(
      JSON.stringify({
        action: "lexCompleteAuthorityUploads",
        completed: authorities.length,
        missing: missing.length
      })
    );
    return { authorities, missing };
  }

  async list(ownerEmail: string): Promise<LexAuthority[]> {
    const res = await this.pg.query<AuthorityRow>(
      `SELECT ${AUTHORITY_COLUMNS} FROM lex_authorities
       WHERE owner_email = $1 ORDER BY created_at DESC`,
      [ownerEmail]
    );
    return res.rows.map(mapAuthority);
  }

  async getOrFail(ownerEmail: string, id: string): Promise<LexAuthority> {
    const res = await this.pg.query<AuthorityRow>(
      `SELECT ${AUTHORITY_COLUMNS} FROM lex_authorities
       WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
    if (res.rows.length === 0)
      throw new NotFoundException("Authority not found");
    return mapAuthority(res.rows[0]);
  }

  /**
   * Retitle and/or enable-disable. Disabling keeps the authority stored and searchable but out
   * of every prompt, which is how the user drops a code from the always-in-context budget
   * without losing its chunks (and without paying to re-ingest it later).
   */
  async update(
    ownerEmail: string,
    id: string,
    patch: UpdateAuthorityRequest
  ): Promise<LexAuthority> {
    if (patch.title === undefined && patch.enabled === undefined)
      throw new BadRequestException("Nothing to update");

    const res = await this.pg.query<AuthorityRow>(
      `UPDATE lex_authorities
         SET title = COALESCE($3, title), enabled = COALESCE($4, enabled), updated_at = now()
       WHERE id = $1 AND owner_email = $2
       RETURNING ${AUTHORITY_COLUMNS}`,
      [id, ownerEmail, patch.title?.trim() ?? null, patch.enabled ?? null]
    );
    if (res.rows.length === 0)
      throw new NotFoundException("Authority not found");
    return mapAuthority(res.rows[0]);
  }

  /**
   * Re-queues ingestion from the stored bytes — for the failures that are not the authority's
   * fault (an embedding outage, a crash mid-code), so a 700-page upload is not repeated.
   */
  async retry(ownerEmail: string, id: string): Promise<LexAuthority> {
    const authority = await this.getOrFail(ownerEmail, id);
    if (authority.status === "awaiting_upload")
      throw new BadRequestException(
        "This authority was never uploaded; delete it instead"
      );

    await this.pg.withTransaction(async (client) => {
      await client.query(
        `UPDATE lex_authorities SET status = 'uploaded', error = NULL, updated_at = now()
         WHERE id = $1`,
        [id]
      );
      await client.query(
        `INSERT INTO lex_authority_jobs (authority_id) VALUES ($1)`,
        [id]
      );
    });
    return this.getOrFail(ownerEmail, id);
  }

  /** The article map injected into chat turns — a sub-resource, fetched on demand. */
  async getDigest(ownerEmail: string, id: string): Promise<LexAuthorityDigest> {
    const res = await this.pg.query<DigestRow>(
      `SELECT id, digest, digest_tokens, updated_at FROM lex_authorities
       WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
    if (res.rows.length === 0)
      throw new NotFoundException("Authority not found");
    const r = res.rows[0];
    return {
      authorityId: r.id,
      digest: r.digest,
      digestTokens: r.digest_tokens,
      updatedAt: iso(r.updated_at)
    };
  }

  /**
   * The digests of every enabled, ready authority — injected into EVERY chat turn, so this runs
   * on the hot path.
   *
   * One query, whose scope clause is served by idx_lex_authorities_enabled, and it never throws:
   * an authority
   * subsystem that is unreachable must degrade to "no law in context" rather than take down the
   * turn. Ordered oldest-first so the always-in-context block is stable between turns and stays
   * cacheable.
   */
  async enabledDigests(ownerEmail: string): Promise<EnabledAuthorityDigest[]> {
    try {
      const res = await this.pg.query<{
        id: string;
        title: string;
        digest: string;
        digest_tokens: number | null;
      }>(
        `SELECT id, title, digest, digest_tokens FROM lex_authorities
         WHERE owner_email = $1 AND enabled = true AND status = 'ready'
           AND digest IS NOT NULL
         ORDER BY created_at ASC`,
        [ownerEmail]
      );
      return res.rows.map((r) => ({
        authorityId: r.id,
        title: r.title,
        digest: r.digest,
        digestTokens: r.digest_tokens
      }));
    } catch (err) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexEnabledDigestsFailed",
          ownerEmail,
          error: String(err)
        })
      );
      return [];
    }
  }

  /**
   * Hybrid retrieval over the user's law: dense (pgvector cosine on the halfvec HNSW index)
   * fused with sparse (FR+NL full-text) via Reciprocal Rank Fusion — the same two legs and the
   * same fusion as RagService uses for documents, because the retrieval problem is the same one.
   *
   * Scoped to the owner and to enabled, ready authorities: a disabled authority stays out of
   * retrieval as well as out of the prompt, so "disabled" means one thing everywhere.
   */
  async retrieve(
    ownerEmail: string,
    query: string,
    topK = 6
  ): Promise<RetrievedArticle[]> {
    const [qvec] = await this.openai.embed(query);
    const qvecStr = `[${qvec.join(",")}]`;

    const select = `c.id, c.authority_id, a.title, c.article_label, c.page_from, c.page_to,
      c.char_start, c.char_end, c.content, c.chunk_index`;
    const scope = `c.owner_email = $1 AND a.enabled = true AND a.status = 'ready'`;

    const vecRes = await this.pg.query<ArticleChunkRow>(
      `SELECT ${select}
       FROM lex_authority_chunks c
       JOIN lex_authorities a ON a.id = c.authority_id
       WHERE ${scope}
       ORDER BY c.embedding <=> $2::halfvec
       LIMIT $3`,
      [ownerEmail, qvecStr, CANDIDATE_LIMIT]
    );

    // The FTS leg is what makes a bare article number findable: "374" carries almost no signal
    // for an embedding, but it is a rare, high-weight lexeme for to_tsvector.
    const tsv = `(to_tsvector('french', c.content) || to_tsvector('dutch', c.content))`;
    const tsq = `(plainto_tsquery('french', $2) || plainto_tsquery('dutch', $2))`;
    const ftsRes = await this.pg.query<ArticleChunkRow>(
      `SELECT ${select}
       FROM lex_authority_chunks c
       JOIN lex_authorities a ON a.id = c.authority_id
       WHERE ${scope} AND ${tsv} @@ ${tsq}
       ORDER BY ts_rank(${tsv}, ${tsq}) DESC
       LIMIT $3`,
      [ownerEmail, query, CANDIDATE_LIMIT]
    );

    return reciprocalRankFusion([vecRes.rows, ftsRes.rows], { topK }).map(
      ({ item, score }) => toRetrieved(item, score)
    );
  }

  /**
   * Exact article lookup. "What does article 374 say" must be a direct hit: a similarity search
   * over a 700-page code will happily return a neighbouring article that reads alike, and
   * quoting the wrong article in a submission is not a recoverable error.
   *
   * Labels are canonicalised through the chunker's normalizeArticleLabel, the same function that
   * produced the stored labels, so "374bis", "art 374 bis" and "Artikel 374 BIS" all hit.
   */
  async retrieveByArticle(
    ownerEmail: string,
    labels: string[]
  ): Promise<RetrievedArticle[]> {
    const canonical = [
      ...new Set(
        labels.map(normalizeArticleLabel).filter((l): l is string => l !== null)
      )
    ];
    if (canonical.length === 0) return [];

    const res = await this.pg.query<ArticleChunkRow>(
      `SELECT c.id, c.authority_id, a.title, c.article_label, c.page_from, c.page_to,
              c.char_start, c.char_end, c.content, c.chunk_index
       FROM lex_authority_chunks c
       JOIN lex_authorities a ON a.id = c.authority_id
       WHERE c.owner_email = $1 AND c.article_label = ANY($2::text[])
         AND a.enabled = true AND a.status = 'ready'
       -- Longest first, then capped: a table-of-contents line carries the same label as the
       -- article it points at, and it is always the shorter of the two. The substantive text
       -- must be the one that survives the cap.
       ORDER BY length(c.content) DESC, c.chunk_index ASC
       LIMIT $3`,
      [ownerEmail, canonical, ARTICLE_LOOKUP_LIMIT]
    );

    return (
      res.rows
        // Selection was by size; presentation is in reading order, so a long article split
        // across several chunks is quoted in the order it is written.
        .sort(
          (a, b) =>
            a.authority_id.localeCompare(b.authority_id) ||
            a.chunk_index - b.chunk_index
        )
        // An exact hit is not ranked; the score exists only to satisfy the shared shape.
        .map((r) => toRetrieved(r, Number.POSITIVE_INFINITY))
    );
  }

  async delete(ownerEmail: string, id: string): Promise<void> {
    const authority = await this.getOrFail(ownerEmail, id);
    try {
      await this.s3.delete(authority.s3Key);
    } catch (err) {
      // Best-effort: keep going so a missing S3 object never blocks row deletion.
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexAuthorityDeleteS3",
          id,
          error: String(err)
        })
      );
    }
    // Chunks and queued jobs go with it (ON DELETE CASCADE), and lex_citations keeps its rows
    // with authority_chunk_id set to NULL — a filed citation is history, not a live reference.
    await this.pg.query(
      `DELETE FROM lex_authorities WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
  }
}
