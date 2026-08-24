import { selectTurns, stripMarkers } from "../context-assembler.service";

// MAX_TURN_TOKENS is 12000 and PROTECTED_ASSESSMENT_TOKENS is 5000, both at ~3.4 chars/token.
// Sizes here are expressed in characters so the arithmetic is visible: 3400 chars ≈ 1000 tokens.
const CHARS_PER_1K_TOKENS = 3400;

const turn = (
  role: "user" | "assistant",
  kTokens: number,
  origin: string | null = null
) => ({
  role,
  content: "x".repeat(Math.round(kTokens * CHARS_PER_1K_TOKENS)),
  origin
});

describe("selectTurns window", () => {
  it("keeps a short thread whole and reserves nothing", () => {
    const turns = [turn("user", 1), turn("assistant", 1), turn("user", 1)];
    const { kept, recovered, oversized } = selectTurns(turns);

    expect(kept).toEqual(turns);
    expect(recovered).toEqual([]);
    expect(oversized).toBe(0);
  });

  it("drops the oldest turns when the thread exceeds the budget", () => {
    // 20k tokens of history against a 12k budget.
    const turns = Array.from({ length: 20 }, () => turn("user", 1));
    const { kept } = selectTurns(turns);

    expect(kept.length).toBeLessThan(turns.length);
    expect(kept.length).toBeGreaterThan(0);
  });

  it("never sacrifices the newest turn, which is the question being asked", () => {
    const newest = turn("user", 1);
    const { kept } = selectTurns([
      ...Array.from({ length: 20 }, () => turn("user", 1)),
      newest
    ]);

    expect(kept[kept.length - 1]).toBe(newest);
  });

  it("keeps a single oversized turn rather than sending no history at all", () => {
    const huge = turn("user", 50);
    const { kept } = selectTurns([turn("user", 1), huge]);

    expect(kept).toEqual([huge]);
  });

  it("returns turns in chronological order", () => {
    const a = turn("user", 1);
    const b = turn("assistant", 1);
    const { kept } = selectTurns([a, b]);

    expect(kept).toEqual([a, b]);
  });
});

describe("selectTurns assessment protection", () => {
  it("does not shrink the window when the thread has no assessment", () => {
    // 12 turns of 1k fits the full 12000 budget only if nothing is reserved.
    const turns = Array.from({ length: 12 }, () => turn("user", 1));
    const { kept } = selectTurns(turns);

    expect(kept).toHaveLength(12);
  });

  it("does NOT reserve for an assessment that is already inside the window", () => {
    // The common shape, right after a background run finishes: its pair is the newest thing in the
    // thread. Reserving here would evict several turns of real history to protect something that
    // was never at risk, and recover nothing.
    const turns = [
      ...Array.from({ length: 10 }, () => turn("user", 1)),
      turn("user", 1, "assessment"),
      turn("assistant", 1, "assessment")
    ];
    const { kept, recovered } = selectTurns(turns);

    expect(kept).toHaveLength(12);
    expect(recovered).toEqual([]);
  });

  it("reserves budget when an assessment falls out of the window", () => {
    // Oldest, behind 20 turns of filler: this one really is at risk, so the reserve is paid.
    const assessed = turn("assistant", 1, "assessment");
    const { kept, recovered } = selectTurns([
      turn("user", 1, "assessment"),
      assessed,
      ...Array.from({ length: 20 }, () => turn("user", 1))
    ]);

    expect(kept).not.toContain(assessed);
    expect(recovered).toContain(assessed);
  });

  it("recovers an assessment the window could not hold", () => {
    // The assessment is oldest, so the window pass drops it; the reserve brings it back.
    const assessment = turn("assistant", 2, "assessment");
    const turns = [
      assessment,
      ...Array.from({ length: 20 }, () => turn("user", 1))
    ];
    const { kept, recovered } = selectTurns(turns);

    expect(kept).not.toContain(assessment);
    expect(recovered).toEqual([assessment]);
  });

  it("does not duplicate an assessment that the window already kept", () => {
    // This is the regression that matters: the same answer twice in one prompt is worse than once.
    const assessment = turn("assistant", 1, "assessment");
    const { kept, recovered } = selectTurns([turn("user", 1), assessment]);

    expect(kept).toContain(assessment);
    expect(recovered).toEqual([]);
  });

  it("recovers at most PROTECTED_ASSESSMENT_ROWS, newest first", () => {
    // Four rows is two runs, since the runner writes a question and an answer per run.
    const rows = Array.from({ length: 6 }, () =>
      turn("assistant", 1, "assessment")
    );
    const filler = Array.from({ length: 20 }, () => turn("user", 1));
    const { recovered } = selectTurns([...rows, ...filler]);

    expect(recovered).toHaveLength(4);
    expect(recovered).toEqual(rows.slice(2));
  });

  it("skips an assessment too large for the reserve instead of truncating it", () => {
    // 6k tokens against a 5k reserve. A half-assessment reads like a whole one, so it is dropped
    // whole and counted, rather than cut.
    const huge = turn("assistant", 6, "assessment");
    const turns = [huge, ...Array.from({ length: 20 }, () => turn("user", 1))];
    const { recovered, oversized } = selectTurns(turns);

    expect(recovered).toEqual([]);
    expect(oversized).toBe(1);
  });

  it("does not recover a question whose answer was too large to come with it", () => {
    // Newest-first visits the answer before its question. Skipping the answer and keeping the
    // short question would emit a block headed "treat their findings as established" with no
    // findings under it.
    const asked = turn("user", 0.2, "assessment");
    const answered = turn("assistant", 6, "assessment");
    const filler = Array.from({ length: 20 }, () => turn("user", 1));
    const { recovered, oversized } = selectTurns([asked, answered, ...filler]);

    expect(recovered).toEqual([]);
    expect(oversized).toBe(1);
  });

  it("always includes an answer in a non-empty recovery set", () => {
    const asked = turn("user", 0.2, "assessment");
    const answered = turn("assistant", 2, "assessment");
    const filler = Array.from({ length: 20 }, () => turn("user", 1));
    const { recovered } = selectTurns([asked, answered, ...filler]);

    expect(recovered.some((m) => m.role === "assistant")).toBe(true);
  });

  it("recovers the question turn alongside the answer, both tagged assessment", () => {
    const asked = turn("user", 1, "assessment");
    const answered = turn("assistant", 1, "assessment");
    const filler = Array.from({ length: 20 }, () => turn("user", 1));
    const { recovered } = selectTurns([asked, answered, ...filler]);

    expect(recovered).toEqual([asked, answered]);
  });

  it("ignores the artifact origin, which is only a pointer to another table", () => {
    const artifact = turn("assistant", 1, "artifact");
    const turns = [
      artifact,
      ...Array.from({ length: 20 }, () => turn("user", 1))
    ];
    const { kept, recovered } = selectTurns(turns);

    expect(kept).not.toContain(artifact);
    expect(recovered).toEqual([]);
  });

  it("keeps the total within MAX_TURN_TOKENS across both passes", () => {
    // The reserve is taken OUT of the budget, not added to it: window + recovered must still fit.
    const assessment = turn("assistant", 2, "assessment");
    const turns = [
      assessment,
      ...Array.from({ length: 30 }, () => turn("user", 1))
    ];
    const { kept, recovered } = selectTurns(turns);

    const chars = [...kept, ...recovered].reduce(
      (n, m) => n + m.content.length,
      0
    );
    expect(Math.ceil(chars / 3.4)).toBeLessThanOrEqual(12000);
  });
});

describe("stripMarkers", () => {
  it("removes the stale source markers a recovered assessment carries", () => {
    // These number a findings list that no longer exists. Left in, the model copies one into its
    // reply and it resolves against the CURRENT turn's SOURCES — a citation to the wrong pièce.
    expect(
      stripMarkers("The transfer is undated [12] and unsigned [312].")
    ).toBe("The transfer is undated  and unsigned .");
  });

  it("leaves bracketed prose alone", () => {
    expect(stripMarkers("the clause [sic] as drafted [art. 374]")).toBe(
      "the clause [sic] as drafted [art. 374]"
    );
  });

  it("is a no-op on text with no markers", () => {
    expect(stripMarkers("no markers here")).toBe("no markers here");
  });
});
