import { buildFullText } from "../../documents/chunker";
import { chunkAuthority } from "../authority-chunker";
import {
  articleMapEntries,
  bucketLines,
  capDigest,
  coverageLine,
  estimateDigestTokens,
  normalizeDigestLines,
  proseLines
} from "../authority-ingestion.worker";

/** The hard budget the digest of ONE authority may spend in EVERY chat turn. */
const DIGEST_MAX_TOKENS = 1500;

function entries(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    label: `Art. ${i + 1}`,
    subject: `Sujet de l'article ${i + 1}`
  }));
}

describe("authority digest", () => {
  describe("articleMapEntries", () => {
    it("derives one entry per article, in reading order, without the heading", () => {
      const { fullText, pageRanges } = buildFullText([
        [
          "CODE CIVIL",
          "",
          "Art. 371. Chacun doit respect à ses père et mère.",
          "",
          "Art. 372 — L'enfant reste sous l'autorité de ses père et mère.",
          ""
        ].join("\n")
      ]);
      expect(articleMapEntries(chunkAuthority(fullText, pageRanges))).toEqual([
        {
          label: "Art. 371",
          subject: "Chacun doit respect à ses père et mère."
        },
        {
          label: "Art. 372",
          subject: "L'enfant reste sous l'autorité de ses père et mère."
        }
      ]);
    });

    it("keeps one entry per article when a long article spans several chunks", () => {
      const { fullText, pageRanges } = buildFullText([
        `Art. 42. ${"Le juge apprécie. ".repeat(600)}`
      ]);
      const chunks = chunkAuthority(fullText, pageRanges);
      expect(chunks.length).toBeGreaterThan(1);
      expect(articleMapEntries(chunks)).toHaveLength(1);
    });
  });

  describe("coverageLine", () => {
    it("states the article span and count so the model can rule the authority out", () => {
      expect(
        coverageLine([
          { label: "Art. 1er", subject: "a" },
          { label: "Art. 1386bis", subject: "b" }
        ])
      ).toBe("[Art. 1er–1386bis · 2 art.]");
    });

    it("does not invent a range for a single article, and is empty with none", () => {
      expect(coverageLine([{ label: "Art. 5", subject: "a" }])).toBe(
        "[Art. 5 · 1 art.]"
      );
      expect(coverageLine([])).toBe("");
    });
  });

  // The map we can build with no model at all — the fallback when a model call fails mid-code.
  describe("bucketLines", () => {
    it("groups consecutive articles into at most maxLines ranged lines", () => {
      const lines = bucketLines(entries(100), 10);
      expect(lines).toHaveLength(10);
      expect(lines[0]).toBe("Art. 1–10 — Sujet de l'article 1");
      expect(lines[9]).toBe("Art. 91–100 — Sujet de l'article 91");
    });

    it("keeps one line per article when they already fit", () => {
      expect(bucketLines(entries(3), 10)).toEqual([
        "Art. 1 — Sujet de l'article 1",
        "Art. 2 — Sujet de l'article 2",
        "Art. 3 — Sujet de l'article 3"
      ]);
    });

    it("returns nothing for no articles", () => {
      expect(bucketLines([], 10)).toEqual([]);
    });
  });

  describe("normalizeDigestLines", () => {
    it("collapses whitespace, drops empties and de-duplicates", () => {
      expect(
        normalizeDigestLines([
          "  Art. 1–10 —   autorité\n parentale ",
          "",
          "Art. 1–10 — autorité parentale",
          "   "
        ])
      ).toEqual(["Art. 1–10 — autorité parentale"]);
    });

    it("caps a runaway line so no single line can blow the budget", () => {
      const [line] = normalizeDigestLines([`Art. 1 — ${"x".repeat(500)}`]);
      expect(line.length).toBe(110);
    });

    it("strips the control bytes Postgres refuses to store in the digest column", () => {
      expect(
        normalizeDigestLines([`Art. 1 — texte${String.fromCharCode(0)}`])
      ).toEqual(["Art. 1 — texte"]);
    });
  });

  // The digest rides along in every turn, so the ceiling is a hard invariant, not a target.
  describe("capDigest", () => {
    it("keeps a digest that fits untouched, with no truncation marker", () => {
      const digest = capDigest(["[Art. 1–10 · 10 art.]", "Art. 1–10 — sujet"]);
      expect(digest).toBe("[Art. 1–10 · 10 art.]\nArt. 1–10 — sujet");
      expect(estimateDigestTokens(digest)).toBeLessThanOrEqual(
        DIGEST_MAX_TOKENS
      );
    });

    it("holds the token ceiling for an absurd number of lines, and says it truncated", () => {
      const digest = capDigest(
        Array.from({ length: 400 }, (_, i) => `Art. ${i} — ${"x".repeat(100)}`)
      );
      expect(estimateDigestTokens(digest)).toBeLessThanOrEqual(
        DIGEST_MAX_TOKENS
      );
      expect(digest.split("\n").pop()).toContain("truncated");
    });

    it("keeps the coverage line first when it truncates the tail", () => {
      const digest = capDigest([
        "[Art. 1–2000 · 2000 art.]",
        ...Array.from(
          { length: 400 },
          (_, i) => `Art. ${i} — ${"x".repeat(100)}`
        )
      ]);
      expect(digest.startsWith("[Art. 1–2000 · 2000 art.]")).toBe(true);
      expect(estimateDigestTokens(digest)).toBeLessThanOrEqual(
        DIGEST_MAX_TOKENS
      );
    });

    it("is deterministic: the same lines always give the same digest", () => {
      const lines = Array.from({ length: 200 }, (_, i) => `Art. ${i} — sujet`);
      expect(capDigest(lines)).toBe(capDigest(lines));
    });

    it("returns an empty digest for no lines", () => {
      expect(capDigest([])).toBe("");
    });
  });

  describe("proseLines", () => {
    it("splits an article-free authority's opening into budgeted lines", () => {
      const lines = proseLines(`Arrêt.  ${"mot ".repeat(4000)}`);
      expect(lines.length).toBeGreaterThan(1);
      expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(110);
      expect(estimateDigestTokens(capDigest(lines))).toBeLessThanOrEqual(
        DIGEST_MAX_TOKENS
      );
    });
  });

  // A 700-page code is ~1000 articles: the whole point of the hierarchical map is that this
  // still fits in the per-turn budget.
  it("keeps a 1000-article code inside the per-turn budget with no model involved", () => {
    const all = entries(1000);
    const digest = capDigest([coverageLine(all), ...bucketLines(all, 40)]);
    expect(estimateDigestTokens(digest)).toBeLessThanOrEqual(DIGEST_MAX_TOKENS);
    expect(digest.split("\n")).toHaveLength(41);
    expect(digest).toContain("[Art. 1–1000 · 1000 art.]");
  });
});
