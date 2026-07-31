import {
  MAX_DOCUMENT_BYTES,
  MAX_UPLOAD_BATCH,
  type LexDocument
} from "@packages/types";
import { api } from "./api";
import { toUploadCandidates, type UploadCandidate } from "./uploadCandidates";

// Re-exported so existing importers keep working; the implementation lives in a module with no
// import.meta.env dependency so it can be unit-tested.
export { toUploadCandidates };
export type { UploadCandidate };

export interface UploadOutcome {
  documents: LexDocument[];
  /** Files rejected before upload, with the reason. */
  rejected: { filename: string; reason: "too_large" }[];
  /** Slots whose bytes never landed in S3. */
  failed: string[];
}

// How many files are PUT to S3 at once. Enough to saturate a normal connection without opening
// 50 sockets and starving the app's own API calls.
const PUT_CONCURRENCY = 4;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/** PUTs one file to its presigned URL. S3 verifies the Content-Type matches the signature. */
async function putToS3(
  url: string,
  file: File,
  contentType: string
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Uploads documents straight to S3: reserve slots, PUT the bytes from the browser, then confirm
 * so ingestion is queued. The bytes never traverse the API — which is what makes a 50-file
 * folder of scanned PDFs possible at all (nginx caps request bodies at 10 MB in production).
 *
 * Progress is reported per completed file so a long folder upload is not a frozen spinner.
 */
export async function uploadDocuments(
  workspaceId: string,
  candidates: UploadCandidate[],
  onProgress?: (done: number, total: number) => void
): Promise<UploadOutcome> {
  const rejected: UploadOutcome["rejected"] = [];
  const accepted = candidates.filter((c) => {
    if (c.file.size > MAX_DOCUMENT_BYTES) {
      rejected.push({ filename: c.filename, reason: "too_large" });
      return false;
    }
    return c.file.size > 0;
  });

  const documents: LexDocument[] = [];
  const failed: string[] = [];
  let done = 0;
  const total = accepted.length;

  // Presign in batches so one giant drop doesn't become one giant request.
  for (const batch of chunk(accepted, MAX_UPLOAD_BATCH)) {
    const { uploads } = await api.lex.documents.presign(
      workspaceId,
      batch.map((c) => ({
        filename: c.filename,
        contentType: c.file.type || undefined,
        size: c.file.size,
        sourcePath: c.sourcePath
      }))
    );

    const landed: string[] = [];
    // Bounded-concurrency PUTs: workers pull from a shared cursor.
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(PUT_CONCURRENCY, uploads.length) }, () =>
        (async () => {
          for (;;) {
            const index = cursor++;
            if (index >= uploads.length) return;
            const slot = uploads[index];
            const ok = await putToS3(
              slot.uploadUrl,
              batch[index].file,
              slot.contentType
            );
            if (ok) landed.push(slot.document.id);
            else failed.push(batch[index].filename);
            onProgress?.(++done, total);
          }
        })()
      )
    );

    if (landed.length > 0) {
      const result = await api.lex.documents.completeUpload(landed);
      documents.push(...result.documents);
      // A slot whose object S3 never received is reported back as missing.
      if (result.missing.length > 0) {
        failed.push(
          ...result.missing.map(
            (id) =>
              uploads.find((u) => u.document.id === id)?.document.filename ?? id
          )
        );
      }
    }
  }

  return { documents, rejected, failed };
}
