/**
 * How a dropped or picked thing becomes a list of readable entries: an Apple Contacts archive
 * (.abbu, a directory bundle) dragged from the Finder, a .zip of it, or a .csv file.
 */

import { unzipSync } from "fflate";

export interface ArchiveEntry {
  /** Path inside the archive, forward slashes. */
  path: string;
  read(): Promise<Uint8Array>;
}

export type Intake =
  | { kind: "abbu"; entries: ArchiveEntry[] }
  | { kind: "csv"; file: File }
  /** A .abbu picked in the file dialog: the browser cannot read a package that way. */
  | { kind: "package" }
  | { kind: "unknown" };

export type FileKind = "csv" | "zip" | "package" | "unknown";

/** What a drop handler must grab before it returns; the DataTransfer is emptied afterwards. */
export interface DropSnapshot {
  entries: FileSystemEntry[];
  files: File[];
}

const PERSON_RECORD = /\.abcdp$/i;

/** True for a person record inside the bundle; AppleDouble and __MACOSX zip leftovers are not. */
export function isPersonRecordPath(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((p) => p === "__MACOSX")) return false;
  const base = parts[parts.length - 1] ?? "";
  if (base.startsWith("._")) return false;
  return PERSON_RECORD.test(base);
}

/** By name only: one .csv, one .zip, one .abbu package, or something else. */
export function classifyFiles(files: { name: string }[]): FileKind {
  if (files.length !== 1) return "unknown";
  const name = files[0].name.toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".abbu")) return "package";
  return "unknown";
}

/** Synchronous on purpose: must run inside the drop handler, before any await. */
export function snapshotDrop(dt: DataTransfer): DropSnapshot {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return { entries, files: Array.from(dt.files ?? []) };
}

/** Files from an <input type="file">. */
export async function intakeFromFiles(files: File[]): Promise<Intake> {
  const kind = classifyFiles(files);
  if (kind === "csv") return { kind: "csv", file: files[0] };
  if (kind === "zip") {
    const bytes = new Uint8Array(await files[0].arrayBuffer());
    return { kind: "abbu", entries: entriesFromZip(bytes) };
  }
  if (kind === "package") return { kind: "package" };
  return { kind: "unknown" };
}

/** A drop: walks directory entries so a .abbu bundle dragged from the Finder is read in place. */
export async function intakeFromDrop(snap: DropSnapshot): Promise<Intake> {
  if (snap.entries.some((entry) => entry.isDirectory)) {
    const entries = await walkEntries(snap.entries);
    return entries.length > 0 ? { kind: "abbu", entries } : { kind: "unknown" };
  }
  return intakeFromFiles(snap.files);
}

/** Every person record under the given entries, directories walked recursively. */
export async function walkEntries(
  entries: FileSystemEntry[]
): Promise<ArchiveEntry[]> {
  const found: ArchiveEntry[] = [];
  for (const entry of entries) await walkEntry(entry, found);
  return found;
}

async function walkEntry(
  entry: FileSystemEntry,
  found: ArchiveEntry[]
): Promise<void> {
  if (entry.isDirectory) {
    const children = await readAllEntries(entry as FileSystemDirectoryEntry);
    for (const child of children) await walkEntry(child, found);
    return;
  }
  if (!entry.isFile) return;
  const path = entry.fullPath.startsWith("/")
    ? entry.fullPath.slice(1)
    : entry.fullPath;
  if (!isPersonRecordPath(path)) return;
  const fileEntry = entry as FileSystemFileEntry;
  found.push({
    path,
    read: async () => {
      const file = await fileFromEntry(fileEntry);
      return new Uint8Array(await file.arrayBuffer());
    }
  });
}

/** Chrome hands back at most 100 entries per call, so read until a batch comes back empty. */
function readAllEntries(
  dir: FileSystemDirectoryEntry
): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  return new Promise((resolve) => {
    const reader = dir.createReader();
    const next = () => {
      try {
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) {
              resolve(all);
              return;
            }
            all.push(...batch);
            next();
          },
          () => resolve(all)
        );
      } catch {
        resolve(all);
      }
    };
    next();
  });
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** The person records inside a zipped bundle; everything else in the zip is left compressed. */
export function entriesFromZip(bytes: Uint8Array): ArchiveEntry[] {
  const unzipped = unzipSync(bytes, {
    filter: (file) => isPersonRecordPath(file.name)
  });
  return Object.keys(unzipped).map((path) => {
    const data = unzipped[path];
    return { path, read: async () => data };
  });
}
