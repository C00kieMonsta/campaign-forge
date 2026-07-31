import { MAX_DOCUMENT_BYTES, type LexAuthority } from "@packages/types";
import { api } from "./api";

/**
 * Uploads authorities (law) straight to S3, same three-step sequence as documents: reserve slots,
 * PUT the bytes from the browser, confirm so ingestion is queued.
 *
 * Kept separate from uploadDocuments rather than generalised: authorities are owner-scoped with no
 * workspace, carry a title distinct from the filename, and are uploaded a couple at a time rather
 * than as 50-file folder drops — so the shared abstraction would be mostly branches.
 */
export async function uploadAuthorities(
  files: File[]
): Promise<{ authorities: LexAuthority[]; failed: string[] }> {
  const accepted = files.filter(
    (f) => f.size > 0 && f.size <= MAX_DOCUMENT_BYTES
  );
  const failed = files.filter((f) => !accepted.includes(f)).map((f) => f.name);
  if (accepted.length === 0) return { authorities: [], failed };

  const { uploads } = await api.lex.authorities.presign(
    accepted.map((f) => ({
      filename: f.name,
      // Default the title to the filename without its extension; the user can rename after.
      title: f.name.replace(/\.[^.]+$/, ""),
      contentType: f.type || undefined,
      size: f.size
    }))
  );

  const landed: string[] = [];
  for (let i = 0; i < uploads.length; i++) {
    const slot = uploads[i];
    try {
      const res = await fetch(slot.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": slot.contentType },
        body: accepted[i]
      });
      if (res.ok) landed.push(slot.authority.id);
      else failed.push(accepted[i].name);
    } catch {
      failed.push(accepted[i].name);
    }
  }

  if (landed.length === 0) return { authorities: [], failed };
  const { authorities, missing } =
    await api.lex.authorities.completeUpload(landed);
  for (const id of missing) {
    failed.push(
      uploads.find((u) => u.authority.id === id)?.authority.filename ?? id
    );
  }
  return { authorities, failed };
}
