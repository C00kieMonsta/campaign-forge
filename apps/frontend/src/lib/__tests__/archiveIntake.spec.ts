import { strToU8, zipSync } from "fflate";
import {
  classifyFiles,
  entriesFromZip,
  intakeFromDrop,
  isPersonRecordPath,
  snapshotDrop,
  walkEntries,
  type ArchiveEntry
} from "../archiveIntake";

// jsdom's File has neither text() nor arrayBuffer(), so a File is only ever a name here.
function namedFile(name: string): File {
  return Object.assign(new Blob([]), { name }) as unknown as File;
}

function record(label: string): Uint8Array {
  return strToU8(`bplist00 ${label}`);
}

async function readAll(
  entries: ArchiveEntry[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    out[entry.path] = new TextDecoder().decode(await entry.read());
  }
  return out;
}

function fileEntry(fullPath: string, bytes?: Uint8Array): FileSystemFileEntry {
  const name = fullPath.split("/").pop() ?? "";
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (ok: (file: File) => void) => {
      const fake = {
        name,
        arrayBuffer: async () => (bytes ?? new Uint8Array()).slice().buffer
      };
      ok(fake as unknown as File);
    }
  } as unknown as FileSystemFileEntry;
}

interface DirOptions {
  /** How readEntries fails on its first call: by error callback or by throwing. */
  failFirst?: "callback" | "throw";
  /** How readEntries fails once the listed batches are used up. */
  failAfterBatches?: "callback";
}

interface FakeDir {
  entry: FileSystemDirectoryEntry;
  calls: () => number;
}

/** A directory whose reader hands out the batches in order, then an empty one. */
function dirEntry(
  fullPath: string,
  batches: FileSystemEntry[][],
  options: DirOptions = {}
): FakeDir {
  let calls = 0;
  const entry = {
    isFile: false,
    isDirectory: true,
    name: fullPath.split("/").pop() ?? "",
    fullPath,
    createReader: () => ({
      readEntries: (
        ok: (batch: FileSystemEntry[]) => void,
        fail?: (err: DOMException) => void
      ) => {
        const index = calls++;
        if (index === 0 && options.failFirst === "throw") {
          throw new Error("reader broke");
        }
        if (index === 0 && options.failFirst === "callback") {
          fail?.(new DOMException("reader broke", "NotReadableError"));
          return;
        }
        if (index >= batches.length && options.failAfterBatches) {
          fail?.(new DOMException("reader broke", "NotReadableError"));
          return;
        }
        ok(batches[index] ?? []);
      }
    })
  } as unknown as FileSystemDirectoryEntry;
  return { entry, calls: () => calls };
}

/** Finder zips leave the UTF-8 name flag unset; clear it so fflate decodes names as Latin-1. */
function clearUtf8NameFlags(zip: Uint8Array): Uint8Array {
  const out = zip.slice();
  for (let i = 0; i + 4 <= out.length; i++) {
    if (out[i] !== 0x50 || out[i + 1] !== 0x4b) continue;
    if (out[i + 2] === 0x03 && out[i + 3] === 0x04) out[i + 7] &= 0xf7;
    if (out[i + 2] === 0x01 && out[i + 3] === 0x02) out[i + 9] &= 0xf7;
  }
  return out;
}

const BUNDLE = "Contacts - 18-10-2026.abbu";
const A = record("A");
const B = record("B");
const C = record("C");

function bundleZip(): Uint8Array {
  return zipSync({
    [`${BUNDLE}/AddressBook-v22.abcddb`]: strToU8("SQLite format 3"),
    [`${BUNDLE}/AddressBook-v22.abcddb-wal`]: strToU8("wal"),
    [`${BUNDLE}/Sources/S1/Metadata/A:ABPerson.abcdp`]: A,
    [`${BUNDLE}/Sources/S1/Metadata/G:ABGroup.abcdg`]: strToU8("group"),
    [`${BUNDLE}/Sources/S1/Images/I.abcdi`]: strToU8("image"),
    [`${BUNDLE}/Sources/S2/Metadata/B:ABPerson.abcdp`]: B,
    [`${BUNDLE}/Sources/S2/Metadata/._B:ABPerson.abcdp`]: strToU8("double"),
    [`${BUNDLE}/Metadata/C:ABPerson.abcdp`]: C,
    [`__MACOSX/${BUNDLE}/Sources/S1/Metadata/._A:ABPerson.abcdp`]:
      strToU8("double"),
    [`__MACOSX/${BUNDLE}/._AddressBook-v22.abcddb`]: strToU8("double")
  });
}

describe("isPersonRecordPath", () => {
  it("accepts a person record anywhere in the tree", () => {
    expect(isPersonRecordPath("Sources/S1/Metadata/A:ABPerson.abcdp")).toBe(
      true
    );
    expect(isPersonRecordPath("Metadata/C:ABPerson.ABCDP")).toBe(true);
  });

  it("rejects groups, databases and AppleDouble leftovers", () => {
    expect(isPersonRecordPath("Sources/S1/Metadata/G:ABGroup.abcdg")).toBe(
      false
    );
    expect(isPersonRecordPath("AddressBook-v22.abcddb")).toBe(false);
    expect(isPersonRecordPath("Sources/S2/Metadata/._B:ABPerson.abcdp")).toBe(
      false
    );
    expect(isPersonRecordPath("__MACOSX/X/Metadata/A:ABPerson.abcdp")).toBe(
      false
    );
  });
});

describe("classifyFiles", () => {
  it("classifies a single file by its extension", () => {
    expect(classifyFiles([{ name: "contacts.csv" }])).toBe("csv");
    expect(classifyFiles([{ name: "Contacts.CSV" }])).toBe("csv");
    expect(classifyFiles([{ name: "Contacts - 18-10-2026.abbu.zip" }])).toBe(
      "zip"
    );
    expect(classifyFiles([{ name: "Contacts - 18-10-2026.abbu" }])).toBe(
      "package"
    );
  });

  it("is unknown for several files, no file or another extension", () => {
    expect(classifyFiles([])).toBe("unknown");
    expect(classifyFiles([{ name: "a.csv" }, { name: "b.csv" }])).toBe(
      "unknown"
    );
    expect(classifyFiles([{ name: "contacts.xlsx" }])).toBe("unknown");
    expect(classifyFiles([{ name: "A:ABPerson.abcdp" }])).toBe("unknown");
  });
});

describe("entriesFromZip", () => {
  it("returns only the person records, with full paths and exact bytes", async () => {
    const entries = entriesFromZip(bundleZip());
    expect(entries.map((e) => e.path).sort()).toEqual([
      `${BUNDLE}/Metadata/C:ABPerson.abcdp`,
      `${BUNDLE}/Sources/S1/Metadata/A:ABPerson.abcdp`,
      `${BUNDLE}/Sources/S2/Metadata/B:ABPerson.abcdp`
    ]);
    expect(await readAll(entries)).toEqual({
      [`${BUNDLE}/Metadata/C:ABPerson.abcdp`]: "bplist00 C",
      [`${BUNDLE}/Sources/S1/Metadata/A:ABPerson.abcdp`]: "bplist00 A",
      [`${BUNDLE}/Sources/S2/Metadata/B:ABPerson.abcdp`]: "bplist00 B"
    });
    const a = entries.find((e) => e.path.endsWith("A:ABPerson.abcdp"));
    expect(Array.from(await a!.read())).toEqual(Array.from(A));
  });

  it("keeps a Latin-1 mangled bundle name as a prefix", async () => {
    const zip = clearUtf8NameFlags(
      zipSync({ "Archief é/Sources/S/Metadata/D:ABPerson.abcdp": record("D") })
    );
    const entries = entriesFromZip(zip);
    expect(entries.map((e) => e.path)).toEqual([
      "Archief Ã©/Sources/S/Metadata/D:ABPerson.abcdp"
    ]);
    expect(new TextDecoder().decode(await entries[0].read())).toBe(
      "bplist00 D"
    );
  });

  it("returns an empty list for a zip without person records", () => {
    const zip = zipSync({ "notes.txt": strToU8("hello") });
    expect(entriesFromZip(zip)).toEqual([]);
  });

  it("throws a plain Error on a corrupt zip", () => {
    expect(() => entriesFromZip(new Uint8Array([1, 2, 3, 4]))).toThrow(Error);
    const truncated = bundleZip().subarray(0, 40);
    expect(() => entriesFromZip(truncated)).toThrow(Error);
  });
});

/** A fake .abbu bundle: records at several depths, one reader that pages, two that fail. */
function fakeBundle() {
  const a = fileEntry(`/${BUNDLE}/Sources/S1/Metadata/A:ABPerson.abcdp`, A);
  const b = fileEntry(`/${BUNDLE}/Sources/S1/Metadata/B:ABPerson.abcdp`, B);
  const c = fileEntry(`/${BUNDLE}/Sources/S2/Metadata/C:ABPerson.abcdp`, C);
  const group = fileEntry(`/${BUNDLE}/Sources/S1/Metadata/G:ABGroup.abcdg`);
  const double = fileEntry(`/${BUNDLE}/Sources/S1/Metadata/._A:ABPerson.abcdp`);
  const db = fileEntry(`/${BUNDLE}/AddressBook-v22.abcddb`);
  const image = fileEntry(`/${BUNDLE}/Sources/S1/Images/I.abcdi`);

  const s1Metadata = dirEntry(`/${BUNDLE}/Sources/S1/Metadata`, [
    [a, group],
    [double, b]
  ]);
  const s1Images = dirEntry(`/${BUNDLE}/Sources/S1/Images`, [[image]]);
  const s1 = dirEntry(`/${BUNDLE}/Sources/S1`, [
    [s1Metadata.entry, s1Images.entry]
  ]);
  const s2Metadata = dirEntry(`/${BUNDLE}/Sources/S2/Metadata`, [[c]], {
    failAfterBatches: "callback"
  });
  const s2 = dirEntry(`/${BUNDLE}/Sources/S2`, [[s2Metadata.entry]]);
  const broken = dirEntry(`/${BUNDLE}/Sources/S3`, [[]], {
    failFirst: "callback"
  });
  const sources = dirEntry(`/${BUNDLE}/Sources`, [
    [s1.entry, s2.entry],
    [broken.entry]
  ]);
  const support = dirEntry(`/${BUNDLE}/.AddressBook-v22_SUPPORT`, [[]]);
  const root = dirEntry(`/${BUNDLE}`, [[db, support.entry], [sources.entry]]);

  return { root, sources, s1Metadata, s2Metadata, broken };
}

describe("walkEntries", () => {
  it("collects nested person records only, paging through readEntries", async () => {
    const bundle = fakeBundle();
    const entries = await walkEntries([bundle.root.entry]);
    expect(entries.map((e) => e.path)).toEqual([
      `${BUNDLE}/Sources/S1/Metadata/A:ABPerson.abcdp`,
      `${BUNDLE}/Sources/S1/Metadata/B:ABPerson.abcdp`,
      `${BUNDLE}/Sources/S2/Metadata/C:ABPerson.abcdp`
    ]);
    expect(await readAll(entries)).toEqual({
      [`${BUNDLE}/Sources/S1/Metadata/A:ABPerson.abcdp`]: "bplist00 A",
      [`${BUNDLE}/Sources/S1/Metadata/B:ABPerson.abcdp`]: "bplist00 B",
      [`${BUNDLE}/Sources/S2/Metadata/C:ABPerson.abcdp`]: "bplist00 C"
    });
    // Two batches, then the empty one that ends the loop.
    expect(bundle.s1Metadata.calls()).toBe(3);
    expect(bundle.sources.calls()).toBe(3);
  });

  it("treats a readEntries error as the end of that directory", async () => {
    const bundle = fakeBundle();
    await walkEntries([bundle.root.entry]);
    expect(bundle.broken.calls()).toBe(1);
    expect(bundle.s2Metadata.calls()).toBe(2);
  });

  it("treats a readEntries that throws as an empty directory", async () => {
    const d = fileEntry("/Bundle/Metadata/D:ABPerson.abcdp", record("D"));
    const throwing = dirEntry("/Bundle/Broken", [[]], { failFirst: "throw" });
    const metadata = dirEntry("/Bundle/Metadata", [[d]]);
    const root = dirEntry("/Bundle", [[throwing.entry, metadata.entry]]);
    const entries = await walkEntries([root.entry]);
    expect(entries.map((e) => e.path)).toEqual([
      "Bundle/Metadata/D:ABPerson.abcdp"
    ]);
    expect(throwing.calls()).toBe(1);
  });

  it("includes top-level file entries that are person records", async () => {
    const e = fileEntry("/E:ABPerson.abcdp", record("E"));
    const other = fileEntry("/notes.txt");
    const entries = await walkEntries([other, e]);
    expect(entries.map((x) => x.path)).toEqual(["E:ABPerson.abcdp"]);
    expect(new TextDecoder().decode(await entries[0].read())).toBe(
      "bplist00 E"
    );
  });
});

describe("intakeFromDrop", () => {
  it("reads a dropped bundle in place", async () => {
    const bundle = fakeBundle();
    const intake = await intakeFromDrop({
      entries: [bundle.root.entry],
      files: [namedFile(BUNDLE)]
    });
    if (intake.kind !== "abbu") throw new Error(`got ${intake.kind}`);
    expect(intake.entries.map((e) => e.path)).toEqual([
      `${BUNDLE}/Sources/S1/Metadata/A:ABPerson.abcdp`,
      `${BUNDLE}/Sources/S1/Metadata/B:ABPerson.abcdp`,
      `${BUNDLE}/Sources/S2/Metadata/C:ABPerson.abcdp`
    ]);
  });

  it("is unknown for a dropped folder without person records", async () => {
    const photos = dirEntry("/Photos", [[fileEntry("/Photos/a.jpg")]]);
    const intake = await intakeFromDrop({
      entries: [photos.entry],
      files: [namedFile("Photos")]
    });
    expect(intake).toEqual({ kind: "unknown" });
  });

  it("is a package for a .abbu handed over as a plain file", async () => {
    const abbu = namedFile("Contacts - 18-10-2026.abbu");
    expect(await intakeFromDrop({ entries: [], files: [abbu] })).toEqual({
      kind: "package"
    });
    const asFileEntry = fileEntry(`/${BUNDLE}`);
    expect(
      await intakeFromDrop({ entries: [asFileEntry], files: [abbu] })
    ).toEqual({ kind: "package" });
  });

  it("hands a single csv back as csv", async () => {
    const csv = namedFile("contacts.csv");
    const intake = await intakeFromDrop({ entries: [], files: [csv] });
    if (intake.kind !== "csv") throw new Error(`got ${intake.kind}`);
    expect(intake.file).toBe(csv);
  });

  it("is unknown for several files or another extension", async () => {
    expect(
      await intakeFromDrop({
        entries: [],
        files: [namedFile("a.csv"), namedFile("b.csv")]
      })
    ).toEqual({ kind: "unknown" });
    expect(
      await intakeFromDrop({ entries: [], files: [namedFile("a.xlsx")] })
    ).toEqual({ kind: "unknown" });
    expect(await intakeFromDrop({ entries: [], files: [] })).toEqual({
      kind: "unknown"
    });
  });
});

describe("snapshotDrop", () => {
  it("captures the directory entries and files synchronously", async () => {
    const bundle = fakeBundle();
    const dt = {
      items: [
        { webkitGetAsEntry: () => bundle.root.entry },
        { webkitGetAsEntry: () => null }
      ],
      files: [namedFile(BUNDLE)]
    } as unknown as DataTransfer;
    const snap = snapshotDrop(dt);
    expect(snap).not.toBeInstanceOf(Promise);
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0]).toBe(bundle.root.entry);
    expect(snap.files.map((f) => f.name)).toEqual([BUNDLE]);

    const intake = await intakeFromDrop(snap);
    if (intake.kind !== "abbu") throw new Error(`got ${intake.kind}`);
    expect(intake.entries).toHaveLength(3);
  });

  it("tolerates items without webkitGetAsEntry", async () => {
    const csv = namedFile("contacts.csv");
    const dt = { items: [{}], files: [csv] } as unknown as DataTransfer;
    const snap = snapshotDrop(dt);
    expect(snap.entries).toEqual([]);
    expect(snap.files).toEqual([csv]);
    const intake = await intakeFromDrop(snap);
    expect(intake.kind).toBe("csv");
  });

  it("tolerates a DataTransfer without items or files", () => {
    const snap = snapshotDrop({} as unknown as DataTransfer);
    expect(snap).toEqual({ entries: [], files: [] });
  });
});
