import { extractCitedIndexes } from "../citation-markers";

describe("extractCitedIndexes", () => {
  it("extracts distinct, ascending, in-bounds indexes", () => {
    expect(extractCitedIndexes("Per [2] and [1], also [2].", 3)).toEqual([
      1, 2
    ]);
  });

  it("ignores out-of-range markers (guards against citing a non-existent source)", () => {
    expect(extractCitedIndexes("See [5] and [1].", 3)).toEqual([1]);
  });

  it("returns [] when there are no markers", () => {
    expect(extractCitedIndexes("no citations here", 3)).toEqual([]);
  });

  it("returns [] when there are zero sources", () => {
    expect(extractCitedIndexes("[1][2]", 0)).toEqual([]);
  });
});
