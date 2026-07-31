// Folder-drop flattening. Split out of uploadDocuments.ts so it is testable: that module imports
// the api client, which reads `import.meta.env` at module scope and therefore cannot be loaded by
// a CommonJS test runner. Pure logic belongs where it can be tested.

export interface UploadCandidate {
  file: File;
  /** Folder path the file came from, when a folder was dropped. */
  sourcePath?: string;
  /** Filename as it will be stored (folder-prefixed when it came from a folder). */
  filename: string;
}

/** The separator between folder segments in a flattened filename. */
export const PATH_SEPARATOR = " › ";

/**
 * Flattens a picked FileList into upload candidates.
 *
 * A dropped folder arrives as a flat list where each File carries its relative path in
 * `webkitRelativePath`. The path is folded into the filename because the rest of the system —
 * timeline, chat source chips, citations in generated documents — identifies a document by its
 * filename alone. A bare "Annexe 2.pdf" among 50 files from 8 folders would be unidentifiable, and
 * in a real court bundle the same annex name genuinely recurs across folders.
 *
 * The untouched path is kept in `sourcePath` for filtering.
 */
export function toUploadCandidates(files: File[]): UploadCandidate[] {
  return files.map((file) => {
    const relative = file.webkitRelativePath || "";
    // The first segment is the dropped folder itself — keep it, it is the most meaningful label
    // ("Pièces adverses"). Only the filename segment is dropped.
    const segments = relative.split("/").filter(Boolean).slice(0, -1);
    return {
      file,
      sourcePath: relative || undefined,
      filename: segments.length
        ? `${segments.join(PATH_SEPARATOR)}${PATH_SEPARATOR}${file.name}`
        : file.name
    };
  });
}
