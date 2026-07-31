import { reciprocalRankFusion } from "../rag-fusion";

describe("reciprocalRankFusion", () => {
  it("ranks an item that appears high in BOTH lists above single-list items", () => {
    const vec = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const fts = [{ id: "a" }, { id: "d" }];
    const out = reciprocalRankFusion([vec, fts], { topK: 4 });
    expect(out[0].item.id).toBe("a");
    expect(out.map((o) => o.item.id)).toContain("d");
  });

  it("dedups by id and sums the reciprocal-rank scores", () => {
    const out = reciprocalRankFusion([[{ id: "a" }], [{ id: "a" }]], {
      topK: 5,
      k: 60
    });
    expect(out).toHaveLength(1);
    expect(out[0].score).toBeCloseTo(2 / 61);
  });

  it("respects topK", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(reciprocalRankFusion([list], { topK: 2 })).toHaveLength(2);
  });

  it("returns [] for empty input", () => {
    expect(reciprocalRankFusion([], { topK: 5 })).toHaveLength(0);
  });
});
