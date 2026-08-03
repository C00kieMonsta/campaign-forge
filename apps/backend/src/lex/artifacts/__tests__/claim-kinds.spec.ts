import type { LexArtifactClaim, LexClaimKind } from "@packages/types";
import {
  isExemptFromVerification,
  statusForClaims,
  tallyClaims
} from "../verification.service";

function claim(
  over: Partial<LexArtifactClaim> & Pick<LexArtifactClaim, "status">
): LexArtifactClaim {
  return { claimId: "c", text: "t", citation: null, ...over };
}

/**
 * WHAT IS VERIFIED, and what it means for a document to be filable.
 *
 * The bug these rules fix, measured on the real 56-document case file: a memo came back
 * "11/16 affirmations sourcées" and was locked out of the filing path, and one of the five failures
 * was "Il est proposé de demander au Tribunal … de reconnaître l'accord". That is a prayer for
 * relief. No pièce in any case file establishes what a party will ask for, so the sentence could
 * never pass, and its presence made an otherwise sound draft permanently unfilable.
 *
 * The fix is a distinction, not a relaxation: only factual assertions are verified, and the gate on
 * them is exactly as strict as it was.
 */
describe("which claims are verified", () => {
  it("never exempts a factual assertion", () => {
    expect(isExemptFromVerification("assertion", false)).toBe(false);
    expect(isExemptFromVerification("assertion", true)).toBe(false);
  });

  // Bodies drafted before kinds existed carry none, and every sentence in them was judged as a
  // fact. Defaulting the other way would silently stop checking every old draft in the database.
  it("never exempts a claim with no kind at all", () => {
    expect(isExemptFromVerification(undefined, false)).toBe(false);
  });

  it("exempts argument, relief and headings that cite nothing", () => {
    const exempt: LexClaimKind[] = ["argument", "relief", "heading"];
    for (const kind of exempt) {
      expect(isExemptFromVerification(kind, false)).toBe(true);
    }
  });

  /**
   * The half that keeps the label honest. If a kind alone could skip verification, a drafter could
   * relabel a shaky factual sentence as `argument` and its citation would never be checked — the
   * label would have become a way to smuggle unsupported evidence into a filing. Citing anything
   * forfeits the exemption.
   */
  it("refuses the exemption to any claim that cites a source, whatever it calls itself", () => {
    expect(isExemptFromVerification("argument", true)).toBe(false);
    expect(isExemptFromVerification("relief", true)).toBe(false);
    expect(isExemptFromVerification("heading", true)).toBe(false);
  });
});

describe("the evidence tally", () => {
  // The denominator is the ASSERTIONS. Counting the prayer for relief among them is what produced
  // "11/16" and reported a request to the court as a missing citation.
  it("counts only verifiable claims, and reports the rest apart", () => {
    const claims = [
      claim({ status: "supported" }),
      claim({ status: "supported" }),
      claim({ status: "contradicted" }),
      claim({ status: "not_checked", kind: "relief" }),
      claim({ status: "not_checked", kind: "heading" })
    ];
    expect(tallyClaims(claims)).toEqual({
      total: 3,
      supported: 2,
      unsupported: 1,
      notChecked: 2
    });
  });

  it("is all-zero for an empty body", () => {
    expect(tallyClaims([])).toEqual({
      total: 0,
      supported: 0,
      unsupported: 0,
      notChecked: 0
    });
  });
});

describe("whether a version is verified", () => {
  // The point of the whole change: a draft whose every FACT is established reaches 'verified' even
  // though it also argues and asks for relief — which is what a court document does.
  it("verifies a body whose every assertion is supported, alongside unverifiable sentences", () => {
    expect(
      statusForClaims([
        claim({ status: "supported" }),
        claim({ status: "not_checked", kind: "relief" }),
        claim({ status: "not_checked", kind: "argument" })
      ])
    ).toBe("verified");
  });

  // Unchanged and must stay unchanged: one fact the file does not establish keeps the document out
  // of a court filing.
  it("still fails on a single unsupported assertion", () => {
    expect(
      statusForClaims([
        claim({ status: "supported" }),
        claim({ status: "contradicted" })
      ])
    ).toBe("failed");
    expect(
      statusForClaims([
        claim({ status: "supported" }),
        claim({ status: "unsupported" })
      ])
    ).toBe("failed");
  });

  /**
   * A document that establishes nothing is not verified.
   *
   * This is the backstop against the one remaining way to game the labels: a drafter that called
   * every sentence `argument` would have zero unsupported assertions, and a green "verified" banner
   * on a court document resting on no evidence at all is the most misleading state this system
   * could produce.
   */
  it("refuses to verify a body with no assertions in it", () => {
    expect(
      statusForClaims([
        claim({ status: "not_checked", kind: "argument" }),
        claim({ status: "not_checked", kind: "relief" })
      ])
    ).toBe("failed");
    expect(statusForClaims([])).toBe("failed");
  });
});
