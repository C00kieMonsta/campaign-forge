import { PATH_SEPARATOR, toUploadCandidates } from "../uploadCandidates";

/** A File carrying the relative path the browser reports for a folder drop. */
function pickedFile(name: string, relativePath?: string): File {
  const file = new File(["x"], name, { type: "application/pdf" });
  // webkitRelativePath is read-only on File, so define it the way the browser would.
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath ?? "",
    writable: false
  });
  return file;
}

describe("toUploadCandidates", () => {
  it("leaves a plainly-picked file's name alone", () => {
    const [c] = toUploadCandidates([pickedFile("Dagvaarding.pdf")]);
    expect(c.filename).toBe("Dagvaarding.pdf");
    expect(c.sourcePath).toBeUndefined();
  });

  it("folds the folder path into the filename and keeps the raw path", () => {
    const [c] = toUploadCandidates([
      pickedFile("Annexe 2.pdf", "01_input/NOUVEL AVOCAT/Annexe 2.pdf")
    ]);
    expect(c.filename).toBe(
      `01_input${PATH_SEPARATOR}NOUVEL AVOCAT${PATH_SEPARATOR}Annexe 2.pdf`
    );
    expect(c.sourcePath).toBe("01_input/NOUVEL AVOCAT/Annexe 2.pdf");
  });

  it("keeps the dropped folder itself, which is the most meaningful label", () => {
    const [c] = toUploadCandidates([
      pickedFile("dagvaarding.pdf", "Pièces adverses/dagvaarding.pdf")
    ]);
    expect(c.filename).toBe(`Pièces adverses${PATH_SEPARATOR}dagvaarding.pdf`);
  });

  // The reason this flattening exists: in a real bundle the same annex name recurs across folders,
  // and every downstream surface (timeline, source chips, citations) identifies a document by its
  // filename alone. Two bare "Annexe 2.pdf" would be indistinguishable in a filed citation.
  it("keeps same-named files from different folders distinguishable", () => {
    const candidates = toUploadCandidates([
      pickedFile("Annexe 2.pdf", "01_input/Annexe 2.pdf"),
      pickedFile("Annexe 2.pdf", "01_input/NOUVEL AVOCAT/Annexe 2.pdf")
    ]);
    expect(candidates[0].filename).not.toBe(candidates[1].filename);
    expect(new Set(candidates.map((c) => c.filename)).size).toBe(2);
  });

  it("handles a deeply nested path", () => {
    const [c] = toUploadCandidates([
      pickedFile("note.pdf", "a/b/c/d/note.pdf")
    ]);
    expect(c.filename).toBe(
      ["a", "b", "c", "d", "note.pdf"].join(PATH_SEPARATOR)
    );
  });

  it("ignores empty path segments rather than emitting blank labels", () => {
    const [c] = toUploadCandidates([
      pickedFile("note.pdf", "01_input//sub//note.pdf")
    ]);
    expect(c.filename).toBe(
      `01_input${PATH_SEPARATOR}sub${PATH_SEPARATOR}note.pdf`
    );
  });

  it("maps every picked file", () => {
    const out = toUploadCandidates([
      pickedFile("a.pdf"),
      pickedFile("b.pdf", "f/b.pdf")
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.file.name)).toEqual(["a.pdf", "b.pdf"]);
  });
});
