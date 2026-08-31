import { Injectable, Logger } from "@nestjs/common";
import type { LexLifecycleState, LexParseStatus } from "@packages/types";
import { PgService } from "../../shared/pg.service";
import { dateOnly } from "./calendar-date";
import {
  buildManifest,
  type BuiltManifest,
  type ManifestDoc
} from "./case-file-manifest";

interface ManifestRow {
  id: string;
  filename: string;
  content_type: string | null;
  parse_status: LexParseStatus;
  lifecycle_state: LexLifecycleState;
  timeline_date: Date | string | null;
  page_count: number | null;
  duration_seconds: number | null;
  summary: string | null;
  language: string | null;
  key_names: unknown;
  tags: unknown;
  source_path: string | null;
  duplicate_of_filename: string | null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/**
 * The always-in-context inventory of a workspace's documents.
 *
 * Same contract as AuthoritiesService.enabledDigests: one indexed query on the hot path, and it
 * never throws. A workspace whose manifest cannot be read must degrade to "no inventory in
 * context", never take the turn down.
 */
@Injectable()
export class CaseFileService {
  private readonly logger = new Logger(CaseFileService.name);

  constructor(private pg: PgService) {}

  /**
   * Per-turn SQL, with no cache and no materialised column. Deliberate, and the reasons matter:
   *
   * - Unlike the authority digest, this costs zero model calls. `summary`, `timeline_date`,
   *   `language`, `key_names` and `tags` are already written per row at the end of ingestion.
   * - One narrow scan of a few dozen to a few hundred rows, served by
   *   idx_lex_documents_workspace_date. The same turn already pays for an embedding round-trip,
   *   two hybrid retrieval queries, the same again for authorities, a summary read and a messages
   *   read. This is the cheapest query on the path.
   * - A CACHE WOULD REINTRODUCE THE BUG. The failure being fixed is "the file is in there but the
   *   model does not know". A 60-second TTL is a 60-second window in which a document the user
   *   just dropped and is asking about right now is absent from the manifest. A materialised
   *   column has that problem plus an invalidation surface: upload, ingestion completion, archive,
   *   restore, retry, duplicate marking and transcript edit. Seven write paths for a free query.
   *
   * If this ever shows up in the logs, the fix is a covering index on (workspace_id, owner_email)
   * with the manifest columns INCLUDEd, not a cache. The lexCaseFileManifest log line is what
   * would say so.
   */
  async manifest(
    ownerEmail: string,
    workspaceId: string
  ): Promise<BuiltManifest | null> {
    try {
      // No status filter: the non-ready rows are exactly the ones that cause the reported bug.
      // The archived split happens below rather than in SQL, so one query serves both groups.
      //
      // The self-join carries the owner scope as well as the id. Every other Lex read is
      // hard-scoped by owner_email, and without it a filename could cross a tenant boundary
      // through duplicate_of once this stops being single-tenant.
      const res = await this.pg.query<ManifestRow>(
        `SELECT d.id, d.filename, d.content_type, d.parse_status, d.lifecycle_state,
                d.timeline_date, d.page_count, d.duration_seconds, d.summary, d.language,
                d.key_names, d.tags, d.source_path,
                orig.filename AS duplicate_of_filename
           FROM lex_documents d
           LEFT JOIN lex_documents orig
             ON orig.id = d.duplicate_of AND orig.owner_email = d.owner_email
          WHERE d.workspace_id = $1 AND d.owner_email = $2
          ORDER BY d.timeline_date ASC NULLS LAST, d.created_at ASC`,
        [workspaceId, ownerEmail]
      );

      const docs: ManifestDoc[] = [];
      const archived: ManifestDoc[] = [];
      for (const r of res.rows) {
        const doc: ManifestDoc = {
          id: r.id,
          filename: r.filename,
          contentType: r.content_type,
          parseStatus: r.parse_status,
          lifecycleState: r.lifecycle_state,
          timelineDate: dateOnly(r.timeline_date),
          pageCount: r.page_count,
          durationSeconds: r.duration_seconds,
          summary: r.summary,
          language: r.language,
          keyNames: asStringArray(r.key_names),
          tags: asStringArray(r.tags),
          sourcePath: r.source_path,
          duplicateOfFilename: r.duplicate_of_filename
        };
        (r.lifecycle_state === "archived" ? archived : docs).push(doc);
      }

      return buildManifest(docs, archived);
    } catch (err) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexCaseFileManifestFailed",
          ownerEmail,
          workspaceId,
          error: String(err)
        })
      );
      return null;
    }
  }
}
