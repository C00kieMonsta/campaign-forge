import { normalizeForMatch, quoteMatchesChunk } from "../verification.service";

// The deterministic gate that stops a fabricated or wrong-source quote from being cited in a
// court artifact. It must accept a verbatim quote (whitespace/case-insensitive) and reject
// anything not literally present in the cited chunk.
describe("verification verbatim backstop", () => {
  it("accepts a verbatim quote present in the chunk", () => {
    expect(
      quoteMatchesChunk(
        "admitted liability",
        "The defendant admitted liability in full."
      )
    ).toBe(true);
  });

  it("is whitespace- and case-insensitive", () => {
    expect(
      quoteMatchesChunk("Admitted   Liability", "...admitted liability...")
    ).toBe(true);
  });

  it("rejects a quote that is not present (hallucinated)", () => {
    expect(
      quoteMatchesChunk(
        "denied all charges",
        "The defendant admitted liability."
      )
    ).toBe(false);
  });

  it("rejects an empty quote", () => {
    expect(quoteMatchesChunk("", "anything")).toBe(false);
  });

  it("normalizeForMatch collapses whitespace and lowercases", () => {
    expect(normalizeForMatch("  Foo\n  Bar ")).toBe("foo bar");
  });
});
