import { ARTIFACT_PACK_SIZE } from "@packages/types";
import type { RetrievedChunk } from "../../ai/rag.service";
import {
  mapWithConcurrency,
  summariseSources
} from "../artifact-generation.service";

let nextChunk = 0;

/**
 * `sources` is the answer to "what did it actually read?" — the question the generate dialog used
 * to leave unanswered while writing a court document from twelve spans out of twelve thousand. It
 * is shown to the user beside the draft, so it has to be faithful to the pack rather than to the
 * citations, which are a smaller set.
 */
function chunk(documentId: string, filename: string): RetrievedChunk {
  return {
    chunkId: `c${(nextChunk += 1)}`,
    pageId: null,
    pageOrdinal: null,
    pageTextHash: null,
    documentId,
    filename,
    pageFrom: null,
    pageTo: null,
    charStart: null,
    charEnd: null,
    content: "…"
  } as RetrievedChunk;
}

describe("summariseSources", () => {
  it("counts the spans each pièce contributed", () => {
    const sources = summariseSources([
      chunk("d1", "requete.pdf"),
      chunk("d2", "contrat-1958.pdf"),
      chunk("d1", "requete.pdf"),
      chunk("d1", "requete.pdf")
    ]);
    expect(sources).toEqual([
      { documentId: "d1", filename: "requete.pdf", passages: 3 },
      { documentId: "d2", filename: "contrat-1958.pdf", passages: 1 }
    ]);
  });

  // The list is read top-down to judge what the draft rests on; a pièce contributing eleven spans
  // and one contributing a single passage are different facts about the draft.
  it("puts the most-drawn-upon pièce first", () => {
    const sources = summariseSources([
      chunk("thin", "annexe.pdf"),
      chunk("thick", "jugement.pdf"),
      chunk("thick", "jugement.pdf")
    ]);
    expect(sources.map((s) => s.documentId)).toEqual(["thick", "thin"]);
  });

  it("breaks ties on the filename, so two runs over one pack render identically", () => {
    const forward = summariseSources([
      chunk("b", "zebre.pdf"),
      chunk("a", "acte.pdf")
    ]);
    const reversed = summariseSources([
      chunk("a", "acte.pdf"),
      chunk("b", "zebre.pdf")
    ]);
    expect(forward).toEqual(reversed);
    expect(forward[0].filename).toBe("acte.pdf");
  });

  it("returns nothing for an empty pack rather than a row of zeroes", () => {
    // An empty pack means retrieval found nothing in the selection — the view must not imply a
    // pièce was read.
    expect(summariseSources([])).toEqual([]);
  });

  it("keeps two pièces that happen to share a filename apart", () => {
    // Uploading the same name twice is ordinary in a case file; merging them would overstate how
    // much of one document was read.
    const sources = summariseSources([
      chunk("d1", "courrier.pdf"),
      chunk("d2", "courrier.pdf")
    ]);
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.passages)).toEqual([1, 1]);
  });
});

describe("the pack sizes the dialog promises", () => {
  // The dialog states these counts before the user commits to a run. They are shared with the
  // server precisely so the promise and the behaviour cannot drift apart.
  it("reads more in full than in search, and both are bounded", () => {
    expect(ARTIFACT_PACK_SIZE.search).toBeGreaterThan(0);
    expect(ARTIFACT_PACK_SIZE.full).toBeGreaterThan(ARTIFACT_PACK_SIZE.search);
    // A pack of every chunk in the dev corpus is 12 765 spans; "full" is a wider sample, not that.
    expect(ARTIFACT_PACK_SIZE.full).toBeLessThan(1000);
  });
});

/**
 * Verification used to be a sequential `for` loop: one frontier-model judge per claim, in series.
 * On a 30-claim draft that is thirty latencies end to end, which is most of why generation outlived
 * nginx's 60s read timeout. Each claim is judged against its own quote, so nothing depends on
 * anything else and the loop was serial for no reason.
 */
describe("mapWithConcurrency", () => {
  it("returns results in INPUT order, not completion order", async () => {
    // The claims are the document's paragraphs. Reordering them by whichever judge answered first
    // would scramble the argument.
    const delays = [40, 5, 25, 0, 15];
    const out = await mapWithConcurrency(delays, 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });

  it("never exceeds the limit", async () => {
    // The bound is what keeps a 40-claim draft from firing 40 simultaneous completions at the
    // frontier tier and meeting the account's rate limit mid-document.
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return null;
    });
    expect(peak).toBe(3);
  });

  it("actually runs concurrently rather than one at a time", async () => {
    // Guards the regression that matters: a "concurrent" map that awaits each item in turn is
    // indistinguishable from the old loop except in wall-clock.
    let concurrentObserved = false;
    let active = 0;
    await mapWithConcurrency(Array.from({ length: 6 }), 3, async () => {
      active += 1;
      if (active > 1) concurrentObserved = true;
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return null;
    });
    expect(concurrentObserved).toBe(true);
  });

  it("handles an empty list and a limit above the item count", async () => {
    expect(await mapWithConcurrency([], 8, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n * 2)).toEqual([
      2, 4
    ]);
  });

  it("propagates a failure rather than returning a hole in the results", async () => {
    // A claim whose judge call throws must fail the run, not silently leave `undefined` where a
    // verdict belongs — that would be filed as an unverified claim with no indication why.
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("judge unavailable");
        return n;
      })
    ).rejects.toThrow("judge unavailable");
  });
});
