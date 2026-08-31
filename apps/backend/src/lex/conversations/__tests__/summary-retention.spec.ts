import { lostFacts } from "../summarization.service";

/**
 * The retention check on the rolling summary.
 *
 * A fold is allowed to reword. It is not allowed to lose the date a prescription runs from or the
 * sum in dispute. Compared on normalised values rather than raw spellings, so rewriting a date
 * passes and dropping it fails.
 *
 * Measured, not gated, for now — see the comment at the call site for why refusing to advance the
 * watermark was deferred.
 */
describe("lostFacts", () => {
  it("reports a date the fold dropped", () => {
    expect(
      lostFacts("Convention du 27 mai 1998.", "Convention de partage.")
    ).toContain("1998-05-27");
  });

  it("accepts a date the fold reformatted to the numeric Belgian order", () => {
    expect(
      lostFacts("Convention du 27 mai 1998.", "Convention du 27/05/1998.")
    ).toEqual([]);
  });

  // The reformatting a "## DATES AND ACTS" heading makes most likely, and the one findDates alone
  // cannot see: its NUMERIC pattern reads dd/mm/yyyy and its lookbehind rejects ISO.
  it("accepts a date the fold reformatted to ISO", () => {
    expect(
      lostFacts("Convention du 27 mai 1998.", "Convention du 1998-05-27.")
    ).toEqual([]);
  });

  it("accepts an ISO date restated as written French", () => {
    expect(lostFacts("Acte du 1998-05-27.", "Acte du 27 mai 1998.")).toEqual(
      []
    );
  });

  it("reports an amount the fold dropped, by value and currency", () => {
    const lost = lostFacts(
      "Soulte de 45.500 EUR à verser.",
      "Une soulte est due."
    );
    expect(lost.some((l) => l.includes("EUR"))).toBe(true);
  });

  it("accepts a summary that keeps every fact and adds more", () => {
    expect(
      lostFacts(
        "Convention du 27 mai 1998, soulte de 45.500 EUR.",
        "Convention du 27 mai 1998, soulte de 45.500 EUR. Expertise ordonnée le 3 novembre 2024."
      )
    ).toEqual([]);
  });

  it("accepts anything when there was no prior summary", () => {
    expect(lostFacts("", "Any new summary at all.")).toEqual([]);
  });

  it("reports nothing when neither summary states a date or a sum", () => {
    expect(lostFacts("Discussion générale.", "Discussion.")).toEqual([]);
  });
});
