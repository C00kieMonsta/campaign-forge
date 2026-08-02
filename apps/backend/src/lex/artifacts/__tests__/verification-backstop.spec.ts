import {
  JUDGE_SYSTEM,
  MAX_JUDGE_CONTEXT_CHARS,
  normalizeForMatch,
  quoteMatchesChunk
} from "../verification.service";

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

/**
 * WHAT THE JUDGE IS ASKED — pinned as a prompt contract, because the question it is asked is what
 * broke, not the model answering it.
 *
 * Measured on the real 56-document case file: the old prompt showed the judge the quote ALONE and
 * rejected 11 of 19 claims, every one carrying a verbatim, correctly-indexed quote. Its reasons
 * were of three shapes — an unresolvable pronoun, an attribution that lives in the document name,
 * and "the citation does not say the defence will argue this", which no 1996 bank letter ever will.
 * With the passage and document shown and the factual-core rule, 6 of 8 previously-rejected claims
 * passed; the two that still fail are genuine overreach.
 *
 * These assertions are the load-bearing halves of that prompt. A future edit that drops one puts
 * the 1-in-8 pass rate back, or — worse for a filing — stops the gate distinguishing an argument
 * from an unsourced fact.
 */
describe("the entailment judge's question", () => {
  it("rules on the sentence's FACTS, not on its advocacy framing", () => {
    // "La défense soutiendra que…" is unfalsifiable against a 1996 exhibit, and demanding it be
    // entailed made a well-drafted legal document unable to reach 'verified' at all.
    expect(JUDGE_SYSTEM).toMatch(/FACTUAL ASSERTION/);
    expect(JUDGE_SYSTEM).toMatch(/ARGUMENT/);
    expect(JUDGE_SYSTEM).toMatch(/even if the sentence also/i);
  });

  it("still fails a sentence asserting a fact the quote does not carry", () => {
    // The half that must never be relaxed. The measured survivor was "ce crédit a financé les
    // travaux" — the quote establishes only that the mortgage was taken out, and on a case that
    // turns on the money trail that is exactly the claim to stop.
    expect(JUDGE_SYSTEM).toMatch(
      /a date, a party, an amount, a document, or a further category/
    );
    expect(JUDGE_SYSTEM).toMatch(/relation between facts differently/);
    expect(JUDGE_SYSTEM).toMatch(/Default to false if there is any doubt/);
  });

  it("tells the judge the passage is for reference resolution, not evidence", () => {
    // Without this the judge reads the whole span as support and stops checking the CITATION,
    // which would quietly convert a citation gate into a document gate.
    expect(JUDGE_SYSTEM).toMatch(
      /NOT evidence for anything the quote itself does not say/
    );
  });

  it("bounds the passage it is shown", () => {
    expect(MAX_JUDGE_CONTEXT_CHARS).toBeGreaterThan(200);
    expect(MAX_JUDGE_CONTEXT_CHARS).toBeLessThanOrEqual(4000);
  });
});
