import type { LexArtifactClaim } from "@packages/types";
import type { RetrievedChunk } from "../../ai/rag.service";
import {
  canKeepVerdict,
  isUnchanged,
  reconcileClaims
} from "../reverification.service";
import { statusForClaims, tallyClaims } from "../verification.service";

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
 * STALENESS IS PER-CLAIM.
 *
 * A verdict is established for one sentence against one quote, independently of every other sentence
 * in the document. Holding "nothing here is verified" at the version level — which is what these
 * rules replaced — meant correcting a single paragraph blanked the standing citations of every other
 * paragraph and sent all of them back to the judge: fifteen frontier-model calls to re-derive answers
 * that were still true, and a screen where sixteen well-sourced sentences all read "awaiting
 * verification".
 */
describe("isUnchanged", () => {
  it("is true only when the sentence, kind, quote and anchor all match", () => {
    expect(isUnchanged(claim(), claim())).toBe(true);
  });

  // The sentence is WHAT IS BEING JUDGED. A rewritten sentence against the same quote is a new
  // question, and it is exactly the edit a lawyer makes to fix a 'contradicted' claim.
  it("is false when the sentence was edited", () => {
    expect(isUnchanged(claim({ text: "Une autre phrase." }), claim())).toBe(
      false
    );
  });

  // The KIND decides whether the claim is judged at all, so changing it invalidates the verdict.
  it("is false when the kind was changed", () => {
    expect(isUnchanged(claim({ kind: "relief" }), claim())).toBe(false);
  });

  // A missing kind reads as `assertion` on both sides, so an untouched legacy claim is not dragged
  // back through the judge just for lacking a field that did not exist when it was drafted.
  it("treats a missing kind as assertion on both sides", () => {
    expect(isUnchanged(claim({ kind: undefined }), claim())).toBe(true);
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
});

describe("reconcileClaims", () => {
  const stored = [
    claim({ claimId: "a" }),
    claim({ claimId: "b" }),
    claim({ claimId: "c", status: "contradicted" })
  ];

  // THE regression this whole change is about.
  it("stales only the edited claim and leaves its neighbours' verdicts standing", () => {
    const submitted = [
      claim({ claimId: "a" }),
      claim({ claimId: "b", text: "Reformulée par l'avocate." }),
      claim({ claimId: "c", status: "contradicted" })
    ];
    const out = reconcileClaims(submitted, stored);
    expect(out.map((c) => c.status)).toEqual([
      "supported",
      "pending",
      "contradicted"
    ]);
    // And the untouched claim keeps its citation, so its chip stays on the page.
    expect(out[0].citation?.quote).toBe(QUOTE);
  });

  /**
   * A pending claim KEEPS its citation. Re-verification needs the anchor to re-read the passage, and
   * the drafter needs the quote in front of her to edit the sentence down to what it establishes.
   * It is not recorded as an established reference: insertCitations files only `supported` claims.
   */
  it("keeps the citation on a staled claim but clears the stale reason", () => {
    const out = reconcileClaims(
      [claim({ text: "Reformulée.", reason: "old verdict" })],
      [claim()]
    );
    expect(out[0].status).toBe("pending");
    expect(out[0].citation?.quote).toBe(QUOTE);
    expect(out[0].reason).toBeNull();
  });

  /**
   * The forgery guard. Verdict fields are taken from the STORED claim, never from the submission —
   * so a client that PATCHes `status: "supported"` onto a sentence it just rewrote gets `pending`,
   * and one that does it to an unchanged claim gets back the verdict the server actually wrote.
   * Without this the citation chip would mean nothing.
   */
  it("ignores a client-supplied status", () => {
    const forgedEdit = reconcileClaims(
      [claim({ text: "Rewritten.", status: "supported" })],
      [claim({ status: "contradicted" })]
    );
    expect(forgedEdit[0].status).toBe("pending");

    const forgedUnchanged = reconcileClaims(
      [claim({ status: "supported" })],
      [claim({ status: "contradicted" })]
    );
    expect(forgedUnchanged[0].status).toBe("contradicted");
  });

  it("treats a claim with no stored counterpart as new, so it gets judged", () => {
    const out = reconcileClaims([claim({ claimId: "brand-new" })], stored);
    expect(out[0].status).toBe("pending");
  });

  /**
   * Deleting the one bad claim is a COMPLETE fix, with no model call.
   *
   * Every surviving claim still holds the verdict it earned against its own quote, so the version is
   * verified the moment the unsupported sentence is gone. Before, the save reset everything to
   * 'unverified' and the lawyer had to pay for a full re-verification to learn what was already known.
   */
  it("verifies a save that only removed the unsupported claim", () => {
    const out = reconcileClaims(
      [claim({ claimId: "a" }), claim({ claimId: "b" })],
      stored
    );
    expect(out.every((c) => c.status === "supported")).toBe(true);
    expect(statusForClaims(out)).toBe("verified");
  });

  it("reports a body with a pending claim as unverified, not failed", () => {
    const out = reconcileClaims(
      [claim({ claimId: "a" }), claim({ claimId: "b", text: "Reformulée." })],
      stored
    );
    expect(statusForClaims(out)).toBe("unverified");
    // The pending claim is NOT counted as one a judge refused: 2 assertions, 1 supported, 0 refused.
    expect(tallyClaims(out)).toEqual({
      total: 2,
      supported: 1,
      unsupported: 0,
      notChecked: 0,
      pending: 1
    });
  });
});

describe("canKeepVerdict", () => {
  it("keeps a standing supported verdict whose quote is still in the span", () => {
    expect(canKeepVerdict(claim(), span(PASSAGE))).toBe(true);
  });

  /**
   * Anything not already `supported` is re-judged — a pending claim because it has never been judged,
   * and a refused one because the lawyer edited it precisely to get a second hearing. Carrying a
   * rejection forward would mean the fix could never take effect.
   */
  it("re-judges every other status", () => {
    for (const status of [
      "pending",
      "unsupported",
      "contradicted",
      "not_checked"
    ] as const) {
      expect(canKeepVerdict(claim({ status }), span(PASSAGE))).toBe(false);
    }
  });

  /**
   * THE case a kept verdict must not paper over: the claim is untouched, but the passage under it is
   * not. A pièce re-ingested with different OCR, or a rebuilt page index, can leave a verbatim quote
   * no longer present in the span it was taken from — and a citation that no longer matches its source
   * is exactly what gate 1 exists to catch. Gate 1 is free, so it runs even on the fast path.
   */
  it("refuses when the quote is no longer in the span", () => {
    expect(
      canKeepVerdict(claim(), span("Un texte entièrement différent."))
    ).toBe(false);
  });

  it("refuses when the anchor no longer resolves to any span", () => {
    expect(canKeepVerdict(claim(), undefined)).toBe(false);
  });

  it("refuses a claim with no citation at all", () => {
    expect(canKeepVerdict(claim({ citation: null }), span(PASSAGE))).toBe(
      false
    );
  });
});
