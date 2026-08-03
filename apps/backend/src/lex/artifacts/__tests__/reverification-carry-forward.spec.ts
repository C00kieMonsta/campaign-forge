import type { LexArtifactClaim } from "@packages/types";
import type { RetrievedChunk } from "../../ai/rag.service";
import { canCarryForward, isUnchanged } from "../reverification.service";

function span(content: string): RetrievedChunk {
  return {
    chunkId: "11111111-1111-1111-1111-111111111111",
    pageId: null,
    pageOrdinal: null,
    pageTextHash: null,
    documentId: "d",
    filename: "Contredits.pdf",
    pageFrom: 6,
    pageTo: 6,
    charStart: 0,
    charEnd: content.length,
    content,
    score: Number.POSITIVE_INFINITY
  };
}

const QUOTE = "a cédé ses actions pour 229.920 euros";
const PASSAGE = `Il résulte de l'acte que Madame ${QUOTE} le 4 octobre 2020.`;

function claim(over: Partial<LexArtifactClaim> = {}): LexArtifactClaim {
  return {
    claimId: "c1",
    text: "La défense fait valoir la cession des actions.",
    kind: "assertion",
    status: "supported",
    reason: "the quote establishes the cession",
    citation: {
      chunkId: "chunk:11111111-1111-1111-1111-111111111111",
      documentId: "d",
      filename: "Contredits.pdf",
      pageFrom: 6,
      pageTo: 6,
      quote: QUOTE
    },
    ...over
  };
}

/**
 * WHEN A RE-CHECK MAY REUSE THE LAST VERDICT.
 *
 * Re-verification exists so a corrected draft can reach 'verified' again — before it, saving an edit
 * reset the version to 'unverified' and nothing could ever produce a second 'verified', so fixing a
 * claim made the document permanently unfilable. But a naive re-check re-judges every claim, which
 * is one frontier-model call per sentence to re-derive answers already given. Carrying an untouched
 * verdict forward is what makes fixing three sentences in a sixteen-claim draft cost three calls.
 *
 * Everything below is about not carrying one forward when it would be a lie.
 */
describe("isUnchanged", () => {
  it("is true only when the sentence, the quote and the anchor all match", () => {
    expect(isUnchanged(claim(), claim())).toBe(true);
  });

  // The sentence is WHAT IS BEING JUDGED. A rewritten sentence against the same quote is a new
  // question, and it is exactly the edit a lawyer makes to fix a 'contradicted' claim.
  it("is false when the sentence was edited", () => {
    expect(isUnchanged(claim({ text: "Une autre phrase." }), claim())).toBe(
      false
    );
  });

  // The quote is the EVIDENCE OFFERED. Swapping it changes what the sentence rests on.
  it("is false when the quote was changed", () => {
    const edited = claim();
    expect(
      isUnchanged(
        { ...edited, citation: { ...edited.citation!, quote: "x" } },
        claim()
      )
    ).toBe(false);
  });

  // The anchor is WHICH PASSAGE the quote is read in — the same words in a different pièce are a
  // different citation, and a footnote pointing at the wrong one is the failure this whole pipeline
  // exists to prevent.
  it("is false when the anchor moved to another span", () => {
    const edited = claim();
    expect(
      isUnchanged(
        {
          ...edited,
          citation: { ...edited.citation!, chunkId: "chunk:other" }
        },
        claim()
      )
    ).toBe(false);
  });

  it("is true for two claims that both cite nothing", () => {
    expect(
      isUnchanged(claim({ citation: null }), claim({ citation: null }))
    ).toBe(true);
  });
});

describe("canCarryForward", () => {
  it("reuses the verdict of an untouched claim whose quote is still in the span", () => {
    expect(canCarryForward(claim(), claim(), span(PASSAGE))).toBe(true);
  });

  it("refuses when there is no previous version to carry from", () => {
    expect(canCarryForward(claim(), undefined, span(PASSAGE))).toBe(false);
  });

  /**
   * A previously REJECTED claim is always re-judged. This is the point of the feature: the lawyer
   * corrected the sentence (or its kind, or its citation) precisely to get a second hearing, and
   * carrying the rejection forward would mean the fix could never take effect.
   */
  it("re-judges a claim that was not supported before", () => {
    for (const status of [
      "unsupported",
      "contradicted",
      "not_checked"
    ] as const) {
      expect(canCarryForward(claim(), claim({ status }), span(PASSAGE))).toBe(
        false
      );
    }
  });

  it("refuses when the claim was edited", () => {
    expect(
      canCarryForward(claim({ text: "Rewritten." }), claim(), span(PASSAGE))
    ).toBe(false);
  });

  /**
   * THE case a carried-forward verdict must not paper over: the claim is untouched, but the passage
   * under it is not. A pièce re-ingested with different OCR, or a rebuilt page index, can leave a
   * verbatim quote no longer present in the span it was taken from — and a citation that no longer
   * matches its source is exactly what gate 1 exists to catch. Gate 1 is free, so it runs even on
   * the fast path.
   */
  it("refuses when the quote is no longer in the span, even for an identical claim", () => {
    expect(
      canCarryForward(claim(), claim(), span("Un texte entièrement différent."))
    ).toBe(false);
  });

  it("refuses when the anchor no longer resolves to any span", () => {
    expect(canCarryForward(claim(), claim(), undefined)).toBe(false);
  });

  it("refuses a claim with no citation at all", () => {
    expect(
      canCarryForward(
        claim({ citation: null }),
        claim({ citation: null }),
        span(PASSAGE)
      )
    ).toBe(false);
  });
});
