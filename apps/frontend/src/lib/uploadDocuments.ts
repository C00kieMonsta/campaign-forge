import {
  MAX_DOCUMENT_BYTES,
  MAX_UPLOAD_BATCH,
  type LexDocument
} from "@packages/types";
import { api } from "./api";

// How many files are PUT to S3 at once. Enough to saturate a normal connection without opening
// 50 sockets and starving the app's own API calls.
const PUT_CONCURRENCY = 4;

export interface UploadCandidate {
  file: File;
  /** Folder path the file came from, when a folder was dropped. */
  sourcePath?: string;
  /** Filename as it will be stored (folder-prefixed when it came from a folder). */
  filename: string;
}

export interface UploadOutcome {
  documents: LexDocument[];
  /** Files rejected before upload, with the reason. */
  rejected: { filename: string; reason: "too_large" }[];
  /** Slots whose bytes never landed in S3. */
  failed: string[];
}

/**
 * Flattens a picked FileList into upload candidates.
 *
 * A dropped folder arrives as a flat FileList where each File carries its relative path in
 * `webkitRelativePath`. The path is folded into the filename (so "Pièces/2024/dagvaarding.pdf"
 * becomes "Pièces › 2024 › dagvaarding.pdf") because the rest of the system — the timeline, the
 * chat's source chips, citations in generated documents — identifies a document by its filename
 * alone. A bare "dagvaarding.pdf" among 50 files from 8 folders would be unidentifiable.
 * The untouched path is also kept in `sourcePath` for filtering.
 */
export function toUploadCandidates(files: File[]): UploadCandidate[] {
  return files.map((file) => {
    const relative = file.webkitRelativePath || "";
    // The first segment of webkitRelativePath is the dropped folder itself; keep it, it is the
    // most meaningful label ("Pièces adverses"). Drop only the filename segment.
    const segments = relative.split("/").filter(Boolean).slice(0, -1);
    return {
      file,
      sourcePath: relative || undefined,
      filename: segments.length
        ? `${segments.join(" › ")} › ${file.name}`
        : file.name
    };
  });
}

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
