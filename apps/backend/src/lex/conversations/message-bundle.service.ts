import type { Writable } from "node:stream";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException
} from "@nestjs/common";
import archiver from "archiver";
import { LexS3Service } from "../../shared/lex-s3.service";
import { PgService } from "../../shared/pg.service";
import type {
  BundleCitationRow,
  BundleMeta,
  BundlePlan
} from "./message-bundle";
import {
  bundleFilename,
  planBundle,
  renderAnswer,
  renderExtraits
} from "./message-bundle";

/**
 * Ceiling on the bundle, summed from lex_documents.size_bytes BEFORE a byte is written.
 *
 * Checked up front so an oversized request fails as a 413 with a readable message, rather than as a
 * download that runs for twenty minutes and dies in the browser. A succession file where one answer
 * cites forty scanned bundles reaches this; nothing else does.
 */
export const MAX_BUNDLE_BYTES = 1_000_000_000;

interface PlannedBundle {
  meta: BundleMeta;
  plan: BundlePlan;
  /** The `Content-Disposition` name, decided before streaming so the header is right. */
  filename: string;
}

interface CitationJoinRow {
  marker_index: number;
  document_id: string | null;
  filename: string | null;
  page_label: string | null;
  page_from: number | null;
  page_to: number | null;
  quote: string | null;
  source_text: string | null;
  s3_key: string | null;
  s3_version_id: string | null;
  size_bytes: string | null;
}

/**
 * Packages one answer as a zip: the pièces it cited, the passages it cited them for, and the answer
 * itself.
 *
 * The whole thing reads from lex_citations, which already stores what is needed — marker, document,
 * anchor and quote — so nothing new is captured at answer time and every historical answer can be
 * bundled too.
 */
@Injectable()
export class MessageBundleService {
  private readonly logger = new Logger(MessageBundleService.name);

  constructor(
    private pg: PgService,
    private s3: LexS3Service
  ) {}

  /**
   * Everything that can fail with a status code, done before the response is committed: ownership,
   * "this answer cites nothing", and the size ceiling. Once write() starts, headers are gone and an
   * error can only truncate the download.
   */
  async plan(ownerEmail: string, messageId: string): Promise<PlannedBundle> {
    const msg = await this.pg.query<{
      id: string;
      content: string;
      created_at: Date;
      title: string | null;
    }>(
      `SELECT m.id, m.content, m.created_at, c.title
       FROM lex_messages m
       JOIN lex_conversations c ON c.id = m.conversation_id
       WHERE m.id = $1 AND m.owner_email = $2`,
      [messageId, ownerEmail]
    );
    if (msg.rows.length === 0) throw new NotFoundException("Message not found");

    // COALESCE, not two queries: a citation anchors to a chunk OR a page, in different tables with
    // different foreign keys (see lexCitationEventSchema), and both carry the text of the span.
    // marker_index IS NOT NULL for the same reason citationsFor filters on it — a row without one
    // cannot be traced back to a place in the answer, so there is no [n] to file it under.
    const res = await this.pg.query<CitationJoinRow>(
      `SELECT c.marker_index, c.document_id, c.page_from, c.page_to, c.quote,
              d.filename, d.s3_key, d.s3_version_id, d.size_bytes,
              p.page_label,
              COALESCE(ch.content, p.text) AS source_text
       FROM lex_citations c
       LEFT JOIN lex_documents d        ON d.id  = c.document_id
       LEFT JOIN lex_document_chunks ch ON ch.id = c.chunk_id
       LEFT JOIN lex_document_pages p   ON p.id  = c.page_id
       WHERE c.owner_email = $1
         AND c.message_id = $2
         AND c.marker_index IS NOT NULL
       ORDER BY c.marker_index`,
      [ownerEmail, messageId]
    );

    if (res.rows.length === 0)
      throw new BadRequestException("This answer cites no source.");

    const rows: BundleCitationRow[] = res.rows.map((r) => ({
      marker: r.marker_index,
      documentId: r.document_id,
      filename: r.filename,
      pageLabel: r.page_label,
      pageFrom: r.page_from,
      pageTo: r.page_to,
      quote: r.quote,
      sourceText: r.source_text,
      s3Key: r.s3_key,
      s3VersionId: r.s3_version_id,
      // BIGINT arrives as a string from pg; Number of a null is 0, which would silently zero the
      // size check.
      sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes)
    }));

    const plan = planBundle(rows);
    if (plan.totalBytes > MAX_BUNDLE_BYTES) {
      throw new PayloadTooLargeException(
        `Bundle too large: ${Math.round(plan.totalBytes / 1e6)} MB across ${plan.documents.length} documents.`
      );
    }

    const row = msg.rows[0];
    const meta: BundleMeta = {
      messageId,
      conversationTitle: row.title,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
      content: row.content
    };

    return { meta, plan, filename: bundleFilename(meta) };
  }

  /**
   * Streams the zip into `out`, which is the HTTP response.
   *
   * A pièce that cannot be fetched does NOT fail the download. The S3 object can be gone while the
   * row survives, and the alternative — a 500 halfway through a 300 MB transfer — costs the reader
   * every document that did resolve. The failure is written into EXTRAITS.md instead, next to the
   * passages it belonged to, which is where someone reconstructing the file will look.
   */
  async write(planned: PlannedBundle, out: Writable): Promise<void> {
    const { meta, plan } = planned;
    const archive = archiver("zip", { zlib: { level: 1 } });
    const failed = new Map<string, string>();

    // An 'error' with no listener on a stream is an uncaught throw, and appendEntry's listeners
    // only exist while an entry is in flight. This one is attached for the whole write.
    archive.on("error", (err) =>
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexBundleArchiveError",
          messageId: meta.messageId,
          error: String(err)
        })
      )
    );
    archive.on("warning", (err) =>
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexBundleArchiveWarning",
          messageId: meta.messageId,
          error: String(err)
        })
      )
    );

    // The reader closing the tab mid-download stops the response, and archiver would then block
    // forever on backpressure with an appendEntry promise that never settles — one hung request per
    // abandoned download, each holding a pièce in memory. Aborting makes the next append reject.
    let done = false;
    const onClose = () => {
      if (!done) archive.abort();
    };
    out.once("close", onClose);

    archive.pipe(out);

    for (const doc of plan.documents) {
      try {
        // One buffer at a time. LexS3Service.get resolves the whole object, so peak memory is the
        // largest single pièce rather than the whole bundle — and appendEntry waits for archiver to
        // drain it into the socket before the next fetch starts, so a slow client cannot make the
        // server hold forty PDFs at once.
        const { body } = await this.s3.get(
          doc.s3Key,
          doc.s3VersionId ?? undefined
        );
        await this.appendEntry(archive, body, doc.entryName);
      } catch (err) {
        failed.set(doc.documentId, "fichier introuvable dans le stockage");
        this.logger.warn(
          JSON.stringify({
            level: "warn",
            action: "lexBundleDocumentMissing",
            messageId: meta.messageId,
            documentId: doc.documentId,
            error: String(err)
          })
        );
      }
    }

    // Last, so the manifest can report which pièces did not make it into the zip beside it.
    await this.appendEntry(
      archive,
      Buffer.from(renderExtraits(plan, meta, failed), "utf8"),
      "EXTRAITS.md"
    );
    await this.appendEntry(
      archive,
      Buffer.from(renderAnswer(meta), "utf8"),
      "reponse.md"
    );

    await archive.finalize();
    done = true;
    out.off("close", onClose);
  }

  /**
   * Append one entry and wait for archiver to have processed it.
   *
   * archiver's append() is fire-and-forget: appending in a loop queues every buffer in memory and
   * the bound on that queue is the whole bundle. Waiting on the matching 'entry' event puts the
   * response's backpressure in charge of how fast S3 is read.
   */
  private appendEntry(
    archive: archiver.Archiver,
    body: Buffer,
    name: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onEntry = (entry: { name?: string }) => {
        if (entry?.name !== name) return;
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        archive.off("entry", onEntry);
        archive.off("error", onError);
      };
      archive.on("entry", onEntry);
      archive.on("error", onError);
      archive.append(body, { name });
    });
  }
}
