import {
  countOutOfRangeMarkers,
  extractCitedIndexes
} from "../citation-markers";

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

describe("countOutOfRangeMarkers", () => {
  it("counts a marker past the end of the sources list", () => {
    expect(countOutOfRangeMarkers("As shown in [9].", 3)).toBe(1);
  });

  it("counts [0], which no source can answer for", () => {
    expect(countOutOfRangeMarkers("See [0].", 3)).toBe(1);
  });

  it("counts every occurrence, not distinct indexes", () => {
    expect(countOutOfRangeMarkers("[9] and again [9] and [12].", 3)).toBe(3);
  });

  it("counts nothing when every marker resolves", () => {
    expect(countOutOfRangeMarkers("[1] and [3].", 3)).toBe(0);
  });

  it("counts nothing in text with no markers", () => {
    expect(countOutOfRangeMarkers("No markers here at all.", 3)).toBe(0);
  });

  // The manifest's #n handles must be invisible to this, or every turn would log a false positive.
  it("ignores the case-file block's #n handles", () => {
    expect(
      countOutOfRangeMarkers("#7 | 1998-05-27 | acte.pdf | INDEXED", 3)
    ).toBe(0);
  });
});
