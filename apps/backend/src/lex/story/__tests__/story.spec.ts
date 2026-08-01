import type { PgService } from "../../../shared/pg.service";
import type { WorkspacesService } from "../../workspaces/workspaces.service";
import {
  excerptAround,
  STORY_JOIN_RADIUS,
  STORY_MAX_CHUNKS,
  STORY_MAX_UNPAIRED_AMOUNTS,
  StoryService
} from "../story.service";

/**
 * The story read is DERIVED ON READ: no table, no migration, no model call. Everything it returns is
 * found by pattern over text already stored, so what has to be proven is not "did the model behave"
 * but four much older things.
 *
 *  1. SCOPE. Every statement is hard-scoped by owner_email AND workspace_id, and to documents the
 *     workspace has not archived. This is a multi-tenant corpus of privileged material and the
 *     workspace id arrives from the browser; the WHERE clause is the whole boundary.
 *  2. THE EXCERPT IS THE DOCUMENT'S OWN TEXT. Every fact, every joined amount and every unpaired sum
 *     travels with a quote, and the product's central claim is that the quote is a SUBSTRING of the
 *     stored chunk — whitespace-collapsed and nothing else. If that ever stops being true the page is
 *     a generator with citations, which is exactly what it exists not to be.
 *  3. CAPS ARE REPORTED. A silently truncated ledger is the worst failure this endpoint can produce:
 *     it looks complete. Every bound the read applies comes back in the payload.
 *  4. IT ASSERTS NOTHING. No total, no role, no claim that a sum and a date belong to one transaction
 *     beyond the adjacency the excerpt shows.
 *
 * Asserted against a stubbed PgService. Two statements are sent, so the stub dispatches on the table
 * name; a test that expected only one would pass on a service that had stopped reading documents.
 */

const flat = (sql: string): string => sql.replace(/\s+/g, " ");

interface ChunkFixture {
  id: string;
  document_id: string;
  content: string;
  char_start: number | null;
  page_from: number | null;
  page_to: number | null;
  document_year: number | null;
}

function chunk(over: Partial<ChunkFixture> = {}): ChunkFixture {
  return {
    id: "chunk-1",
    document_id: "doc-1",
    content: "Sans intérêt.",
    char_start: 0,
    page_from: 1,
    page_to: 1,
    document_year: 2023,
    ...over
  };
}

/**
 * A miniature of the real file: two filings restating one donation, a death sentence, a balance that
 * stands next to no date, and a document that says nothing datable at all.
 *
 * Single-spaced on purpose. excerptAround collapses whitespace, so a fixture with newlines could not
 * be used for the `content.includes(excerpt)` assertion that is the point of half these tests — the
 * newline case gets its own test below, against the collapsed form.
 */
const CORPUS: ChunkFixture[] = [
  chunk({
    id: "c-a",
    document_id: "doc-conclusions-2023",
    document_year: 2023,
    page_from: 4,
    page_to: 4,
    content:
      "Le rapport est dû. La donation du 5 janvier 1992 portait sur 1.500.000 BEF au profit de la société IMMO AMBRE (pièce 12)."
  }),
  chunk({
    id: "c-b",
    document_id: "doc-conclusions-2024",
    document_year: 2024,
    page_from: 2,
    page_to: 2,
    content:
      "La donation du 5 janvier 1992 de 1.500.000 BEF n'a jamais été déclarée."
  }),
  chunk({
    id: "c-c",
    document_id: "doc-requete-2019",
    document_year: 2019,
    page_from: 1,
    page_to: 1,
    content:
      "Feu Monsieur Jacques PIRSON, décédé le 27 mai 1998, laissait cinq enfants."
  }),
  chunk({
    id: "c-d",
    document_id: "doc-releve",
    document_year: 1998,
    page_from: 7,
    page_to: 7,
    content: "Le solde du compte s'élevait alors à 934.628 BEF."
  }),
  chunk({
    id: "c-e",
    document_id: "doc-pv-2020",
    document_year: 2020,
    page_from: 1,
    page_to: 1,
    content:
      "Procès-verbal d'ouverture des opérations du 7 octobre 2020, en présence du notaire-liquidateur."
  })
];

/** Documents the workspace holds, including one that never reaches the chunk query. */
const DOCUMENT_IDS = [
  "doc-conclusions-2023",
  "doc-conclusions-2024",
  "doc-photo-sans-texte",
  "doc-pv-2020",
  "doc-releve",
  "doc-requete-2019"
];

describe("StoryService", () => {
  let pg: { query: jest.Mock };
  let workspaces: { getOrFail: jest.Mock };
  let service: StoryService;

  /** Both statements, dispatched on the table. The chunk query joins lex_documents, so order matters. */
  const serve = (chunks: ChunkFixture[], documentIds = DOCUMENT_IDS) => {
    pg.query.mockImplementation(async (sql: string) => {
      if (flat(sql).includes("FROM lex_document_chunks"))
        return { rows: chunks };
      if (flat(sql).includes("FROM lex_documents"))
        return { rows: documentIds.map((id) => ({ id })) };
      throw new Error(`unexpected statement: ${flat(sql)}`);
    });
  };

  beforeEach(() => {
    pg = { query: jest.fn() };
    workspaces = { getOrFail: jest.fn().mockResolvedValue({ id: "ws-1" }) };
    service = new StoryService(
      pg as unknown as PgService,
      workspaces as unknown as WorkspacesService
    );
    serve(CORPUS);
  });

  const read = () => service.story("lawyer@example.com", "ws-1");

  // ── Scope ────────────────────────────────────────────────────────────────────────────────

  describe("ownership and scope", () => {
    it("refuses before it reads: the workspace is proven to belong to the caller first", async () => {
      // getOrFail throws for a workspace the caller does not own. If the scan ran first, a probe with
      // someone else's workspace id would still have touched their chunks.
      workspaces.getOrFail.mockRejectedValue(new Error("not found"));

      await expect(read()).rejects.toThrow("not found");
      expect(pg.query).not.toHaveBeenCalled();
    });

    it("scopes every statement by workspace AND owner", async () => {
      // Both conjuncts, on both statements. workspace_id alone is not enough — ids are guessable and
      // arrive from the browser — and owner_email alone would leak across a practitioner's own cases.
      await read();

      expect(pg.query).toHaveBeenCalledTimes(2);
      for (const [sql, params] of pg.query.mock.calls) {
        const s = flat(sql);
        expect(s).toMatch(/workspace_id = \$1/);
        expect(s).toMatch(/owner_email = \$2/);
        expect(params[0]).toBe("ws-1");
        expect(params[1]).toBe("lawyer@example.com");
      }
      expect(workspaces.getOrFail).toHaveBeenCalledWith(
        "lawyer@example.com",
        "ws-1"
      );
    });

    it("reads only active, parsed documents — an archived pièce is out of the case file", async () => {
      // Archiving is how a practitioner takes a document out of the file. A derived view that still
      // quoted it would make the archive button a lie, and would put a withdrawn pièce into an
      // exposé des faits she pastes into conclusions.
      await read();

      for (const [sql] of pg.query.mock.calls) {
        const s = flat(sql);
        expect(s).toContain("lifecycle_state = 'active'");
        expect(s).toContain(
          "parse_status NOT IN ('awaiting_upload', 'failed')"
        );
      }
    });

    it("is read-only: no statement writes, and none is DDL", async () => {
      // The endpoint is a GET the page calls on every visit. There is no table behind it by design,
      // and this is the assertion that keeps it that way when a cache looks tempting.
      await read();

      for (const [sql] of pg.query.mock.calls) {
        expect(sql).toMatch(/^\s*SELECT/i);
        expect(sql).not.toMatch(
          /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT)\b/i
        );
      }
    });
  });

  // ── The excerpt is the document's own text ───────────────────────────────────────────────

  describe("every quote is a substring of the stored chunk", () => {
    /** chunkId → the text the database holds, which is what a quote has to be cut from. */
    const stored = new Map(CORPUS.map((row) => [row.id, row.content]));

    it("holds for every fact sample, joined amount, unpaired sum and raw amount", async () => {
      const story = await read();

      const quotes: { where: string; chunkId: string; excerpt: string }[] = [
        ...story.facts.flatMap((fact) =>
          fact.samples.map((sample) => ({
            where: `fact ${fact.iso}`,
            chunkId: sample.chunkId,
            excerpt: sample.excerpt
          }))
        ),
        ...story.facts.flatMap((fact) =>
          fact.amounts.map((amount) => ({
            where: `fact ${fact.iso} amount ${amount.raw}`,
            chunkId: amount.chunkId,
            excerpt: amount.excerpt
          }))
        ),
        ...story.deathMentions.flatMap((death) =>
          death.samples.map((sample) => ({
            where: `death ${death.iso}`,
            chunkId: sample.chunkId,
            excerpt: sample.excerpt
          }))
        ),
        ...story.unpairedAmounts.map((amount) => ({
          where: `unpaired ${amount.raw}`,
          chunkId: amount.chunkId,
          excerpt: amount.excerpt
        })),
        ...story.amounts.map((amount) => ({
          where: `amount ${amount.raw}`,
          chunkId: amount.chunkId,
          excerpt: amount.excerpt
        }))
      ];

      // A guard on the guard: `for (const x of [])` satisfies every assertion below it, so a
      // regression that stopped emitting quotes would turn this test green. The exact count is
      // asserted rather than a floor, so dropping one list from the sweep fails here.
      expect(quotes.length).toBe(10);
      for (const quote of quotes) {
        const content = stored.get(quote.chunkId);
        expect(content).toBeDefined();
        expect({
          where: quote.where,
          contained: content?.includes(quote.excerpt)
        }).toEqual({ where: quote.where, contained: true });
      }
    });

    it("quotes the sentence that carries BOTH halves of a date × amount pair", async () => {
      // The pair's claim is adjacency, so the excerpt has to show it. Quoting a window around the
      // date alone could cut the figure off and leave a row asserting a link the reader cannot check.
      const story = await read();
      const fact = story.facts.find((f) => f.iso === "1992-01-05");

      expect(fact?.amounts[0].excerpt).toContain("5 janvier 1992");
      expect(fact?.amounts[0].excerpt).toContain("1.500.000 BEF");
    });

    it("collapses whitespace and changes nothing else", async () => {
      // Extracted PDF text is full of stray newlines, so the excerpt is unreadable without this. It
      // is the ONLY alteration: the collapsed source still contains the quote verbatim.
      const wrapped = chunk({
        id: "c-wrapped",
        document_id: "doc-wrapped",
        content:
          "La donation\ndu 5 janvier 1992\tportait sur  1.500.000 BEF selon la pièce 12."
      });
      serve([wrapped]);

      const story = await read();
      const excerpt = story.facts[0].samples[0].excerpt;

      expect(excerpt).not.toContain("\n");
      expect(wrapped.content.replace(/\s+/g, " ")).toContain(excerpt);
      expect(excerpt).toContain("5 janvier 1992");
    });

    it("anchors each sighting to the document, chunk and page it was cut from", async () => {
      // Without the anchor the quote is unverifiable, which is the same as unusable: C2 is "opens the
      // document at its page", and pageFrom is what the viewer scrolls to.
      const story = await read();
      const sample = story.facts.find((f) => f.iso === "1998-05-27")
        ?.samples[0];

      expect(sample).toMatchObject({
        documentId: "doc-requete-2019",
        chunkId: "c-c",
        pageFrom: 1,
        raw: "27 mai 1998"
      });
    });
  });

  // ── The registry ─────────────────────────────────────────────────────────────────────────

  describe("the registry", () => {
    it("is chronological, one row per distinct date", async () => {
      // A ledger, not a ranking. The reading task is a file that runs over decades; the weight of
      // each row is printed on it as a document count, so the axis is free to be time.
      const story = await read();

      expect(story.facts.map((f) => f.iso)).toEqual([
        "1992-01-05",
        "1998-05-27",
        "2020-10-07"
      ]);
    });

    it("counts the DOCUMENTS that state a date, not the times it is written", async () => {
      // One filing repeating a date is rhetoric; two filings stating it is corroboration. The whole
      // control bar cuts on this number, so conflating it with mentionCount would mis-rank the file.
      const story = await read();
      const fact = story.facts.find((f) => f.iso === "1992-01-05");

      expect(fact?.documentCount).toBe(2);
      expect(fact?.samples.map((s) => s.documentId)).toEqual([
        "doc-conclusions-2023",
        "doc-conclusions-2024"
      ]);
    });

    it("keeps the most-cited-first list the existing view reads", async () => {
      // actDates is the same aggregation under a different sort. Dropping it would blank the page
      // that ships today; deriving it on the client would put the sort rule in two places.
      const story = await read();

      expect(story.actDates.map((d) => d.documentCount)).toEqual([2, 1, 1]);
      expect(story.actDates[0].iso).toBe("1992-01-05");
      expect(story.actDates.map((d) => d.iso).sort()).toEqual(
        story.facts.map((f) => f.iso).sort()
      );
    });
  });

  // ── The date × amount join ───────────────────────────────────────────────────────────────

  describe("the date × amount join", () => {
    it("reports a sum standing beside a date, with the documents that write the pair", async () => {
      // Belgian succession law values a liberality at the date of the donation, so (date, amount,
      // currency) is the unit a practitioner reasons in. Shown as two separate panels she has to
      // join in her head, it is four unrelated facts.
      const story = await read();
      const fact = story.facts.find((f) => f.iso === "1992-01-05");

      expect(fact?.amounts).toHaveLength(1);
      expect(fact?.amounts[0]).toMatchObject({
        value: 1500000,
        currency: "BEF",
        raw: "1.500.000 BEF",
        documentCount: 2
      });
      expect(fact?.amountCount).toBe(1);
    });

    it("requires each side to be the other's nearest neighbour", async () => {
      // Without mutual nearest, one figure at the end of a sentence is attributed to every date in
      // it. Here the amount belongs to the second date by proximity; the first must come back bare
      // rather than borrow it.
      serve([
        chunk({
          id: "c-two-dates",
          document_id: "doc-two-dates",
          content: "Le 1 février 2010 puis le 2 mars 2011 pour 10.000 EUR."
        })
      ]);

      const story = await read();

      expect(story.facts.find((f) => f.iso === "2010-02-01")?.amounts).toEqual(
        []
      );
      expect(
        story.facts.find((f) => f.iso === "2011-03-02")?.amounts[0]
      ).toMatchObject({ value: 10000, currency: "EUR" });
    });

    it("does not reach across a clause: past the radius, nothing is joined", async () => {
      // The radius is about half a clause. Widened, the join stops observing an adjacency and starts
      // asserting a link — which is the one thing a derived view may not do.
      const filler = "x".repeat(STORY_JOIN_RADIUS + 5);
      serve([
        chunk({
          id: "c-far",
          document_id: "doc-far",
          content: `Acte du 3 mars 2003 ${filler} et 4.000 EUR.`
        })
      ]);

      const story = await read();

      expect(story.facts[0].amounts).toEqual([]);
      expect(story.facts[0].amountCount).toBe(0);
      // Not lost, only unpaired: the footer names it so no figure disappears.
      expect(story.unpairedAmounts.map((a) => a.value)).toEqual([4000]);
    });

    it("lists the distinct sums that never stand beside a date", async () => {
      // Most distinct sums on the real corpus are unpaired. A ledger that hid them while claiming to
      // be the file's money would be the more misleading artefact.
      const story = await read();

      expect(story.unpairedAmounts.map((a) => a.raw)).toEqual(["934.628 BEF"]);
      expect(story.unpairedAmounts[0].documentCount).toBe(1);
      expect(story.distinctAmountCount).toBe(2);
    });

    it("censuses the currencies, because BEF in a 2024 filing dates the act it discusses", async () => {
      const story = await read();

      expect(story.amountCensus).toEqual([
        { currency: "BEF", mentionCount: 3, documentCount: 3 }
      ]);
    });

    it("never adds two sums together", async () => {
      // A previous version showed a grand total of every mention in the file and it was rejected,
      // correctly: adding a 1992 donation to a 1998 account balance produces a number that describes
      // nothing. The payload carries counts of figures, never a figure made of figures.
      const story = await read();
      const serialized = JSON.stringify(story);

      expect(serialized).not.toContain("2434628");
      expect(serialized).not.toContain("3000000"); // 1.500.000 BEF stated twice
    });
  });

  // ── The death anchor ─────────────────────────────────────────────────────────────────────

  describe("the death anchor", () => {
    it("reports a date the file writes 'décédé le' directly in front of", async () => {
      // The date of death decides which succession law governs the whole file, so this is the
      // strictest derivation in the payload — and it still only reports that N documents write the
      // sentence, quoted. Whose succession, which régime and every prescription horizon are readings.
      const story = await read();

      expect(story.deathMentions).toHaveLength(1);
      expect(story.deathMentions[0]).toMatchObject({
        iso: "1998-05-27",
        documentCount: 1
      });
      expect(story.deathMentions[0].samples[0].excerpt).toContain(
        "décédé le 27 mai 1998"
      );
    });

    it("is not fired by 'feu' sitting next to an unrelated date", async () => {
      // The measured failure of the loose rule: it tagged a 1958 marriage contract as a death because
      // "feu Monsieur Jacques PIRSON" appears beside it. A wrong death date is the most damaging
      // thing this page could display.
      serve([
        chunk({
          id: "c-feu",
          document_id: "doc-contrat-1958",
          content:
            "Contrat de mariage du 10 juillet 1958 entre feu Monsieur Jacques PIRSON et son épouse."
        })
      ]);

      const story = await read();

      expect(story.deathMentions).toEqual([]);
      // The date is still a fact; it is only not a death.
      expect(story.facts.map((f) => f.iso)).toEqual(["1958-07-10"]);
    });

    it("leaves the corroboration floor to the caller instead of filtering silently", async () => {
      // The view shows deaths stated by two or more pièces. Applying that here would make a
      // single-document death vanish with no trace, and the difference between "no such sentence" and
      // "one pièce says it" is exactly what a practitioner needs to see.
      const story = await read();

      expect(story.deathMentions[0].documentCount).toBe(1);
    });
  });

  // ── The vocabulary badges ────────────────────────────────────────────────────────────────

  describe("what the text says around a date", () => {
    it("carries the words the file itself uses, in table order rather than text order", async () => {
      // Two facts must never disagree about how their badges are arranged, or the eye cannot compare
      // rows. Here "rapport" is written first and "donation" second; the table's order wins.
      const story = await read();
      const fact = story.facts.find((f) => f.iso === "1992-01-05");

      expect(fact?.notions).toEqual(["donation", "rapport"]);
      expect(fact?.qualifications).toEqual([]);
    });

    it("attaches a procedural milestone only when it runs into the date", async () => {
      // "procès-verbal d'ouverture des opérations du 7 octobre 2020" names its own date; the same
      // words two lines later do not. The asymmetric rule is what makes this the most precise
      // derivation on the page.
      const story = await read();
      const fact = story.facts.find((f) => f.iso === "2020-10-07");

      expect(fact?.milestones).toEqual(["pv-ouverture"]);
      expect(
        story.facts.find((f) => f.iso === "1992-01-05")?.milestones
      ).toEqual([]);
    });

    it("returns exhibit references as literal text, never resolved to a document", async () => {
      // The numbering is per party and per filing and it collides. Putting a wrong pièce number into
      // conclusions filed under art. 744 C. jud. is strictly worse than putting none, so the payload
      // hands back the characters the filing wrote and stops.
      const story = await read();
      const fact = story.facts.find((f) => f.iso === "1992-01-05");

      expect(fact?.refs).toEqual(["pièce 12"]);
      expect(JSON.stringify(fact?.refs)).not.toContain("doc-");
    });

    it("assigns no role and no direction of payment to anyone named", async () => {
      // C3, and it is also the legally correct refusal: in a rapport dispute the identity of the
      // donee and the direction of the flow are the contested questions. Names appear only inside
      // quoted text.
      const story = await read();
      const keys = new Set<string>();
      JSON.stringify(story, (key, value) => (keys.add(key), value));

      for (const forbidden of [
        "payer",
        "payee",
        "recipient",
        "donor",
        "donee",
        "role",
        "heir"
      ])
        expect([...keys].map((k) => k.toLowerCase())).not.toContain(forbidden);
    });
  });

  // ── The separate pile ────────────────────────────────────────────────────────────────────

  describe("documents that put no date into the registry", () => {
    it("names them, including one no chunk of which the scan ever saw", async () => {
      // CLS Legal's rule for a box of documents: undated material is never dropped from a chronology,
      // it is kept in a separate pile. doc-releve states a sum and no date; doc-photo-sans-texte
      // matches neither pattern, so it never reaches the chunk query at all — which is precisely why
      // the document list is read separately instead of being inferred from the chunks.
      const story = await read();

      expect(story.undatedDocumentIds).toEqual([
        "doc-photo-sans-texte",
        "doc-releve"
      ]);
    });

    it("can never name an archived document, because both statements share one scope", async () => {
      // If the document list were scoped more loosely than the chunk scan, every archived pièce would
      // surface in the footer as "sans date extraite" — turning the archive into a leak.
      await read();
      const [chunkSql, documentSql] = pg.query.mock.calls.map(([sql]) =>
        flat(sql)
      );

      for (const predicate of [
        "lifecycle_state = 'active'",
        "parse_status NOT IN ('awaiting_upload', 'failed')"
      ]) {
        expect(chunkSql).toContain(predicate);
        expect(documentSql).toContain(predicate);
      }
    });
  });

  // ── Bounds ───────────────────────────────────────────────────────────────────────────────

  describe("bounds, and saying so", () => {
    it("reports truncation instead of returning a partial ledger that looks whole", async () => {
      // The single worst failure this endpoint can have. One row past the cap is how truncation is
      // detected without a second COUNT; that row must not be scanned, or the count would be off by
      // one and the flag would be the only honest thing in the payload.
      const overflowing = Array.from({ length: STORY_MAX_CHUNKS + 1 }, (_, i) =>
        chunk({
          id: `c-${i}`,
          document_id: `doc-${i}`,
          content: "Acte du 3 mars 2003."
        })
      );
      serve(overflowing, []);

      const story = await read();

      expect(story.truncated).toBe(true);
      expect(story.chunksScanned).toBe(STORY_MAX_CHUNKS);
      expect(story.chunkLimit).toBe(STORY_MAX_CHUNKS);
      expect(story.facts[0].documentCount).toBe(STORY_MAX_CHUNKS);
    });

    it("asks the database for exactly one row more than it will scan", async () => {
      await read();
      const [, params] = pg.query.mock.calls[0];

      expect(params[4]).toBe(STORY_MAX_CHUNKS + 1);
    });

    it("says false when nothing was cut", async () => {
      const story = await read();

      expect(story.truncated).toBe(false);
      expect(story.caps).toEqual({
        facts: { returned: 3, total: 3, limit: expect.any(Number) },
        deathMentions: { returned: 1, total: 1, limit: expect.any(Number) },
        unpairedAmounts: { returned: 1, total: 1, limit: expect.any(Number) }
      });
    });

    it("reports the size a capped list was cut from, not the size it shipped", async () => {
      // C8: a cap is allowed, but it has to state what it hid. A caption reading "400 montants" over
      // a list of 400 cut from 405 is worse than no caption, because it reads as the whole file.
      const overflow = 5;
      const many = Array.from(
        { length: STORY_MAX_UNPAIRED_AMOUNTS + overflow },
        (_, i) =>
          chunk({
            id: `c-${i}`,
            document_id: `doc-${i}`,
            content: `Versement de 12.${String(i).padStart(3, "0")} EUR sans date.`
          })
      );
      serve(many, []);

      const story = await read();
      const cap = story.caps.unpairedAmounts;

      expect(cap).toEqual({
        returned: STORY_MAX_UNPAIRED_AMOUNTS,
        total: STORY_MAX_UNPAIRED_AMOUNTS + overflow,
        limit: STORY_MAX_UNPAIRED_AMOUNTS
      });
      expect(story.unpairedAmounts).toHaveLength(cap.returned);
    });

    it("scans each chunk once, whatever it is looking for", async () => {
      // Folding a chunk is the expensive half of the work and there are six detectors. A second loop
      // per detector turns a ~200 ms read into a timeout on a corpus ten times this size.
      await read();

      expect(pg.query).toHaveBeenCalledTimes(2);
    });
  });

  // ── Degenerate corpora ───────────────────────────────────────────────────────────────────

  describe("a file with nothing in it", () => {
    it("returns empty lists rather than throwing, and still names its documents", async () => {
      serve([], ["doc-only-scans"]);

      const story = await read();

      expect(story.facts).toEqual([]);
      expect(story.amounts).toEqual([]);
      expect(story.deathMentions).toEqual([]);
      expect(story.amountCensus).toEqual([]);
      expect(story.distinctAmountCount).toBe(0);
      expect(story.undatedDocumentIds).toEqual(["doc-only-scans"]);
      expect(story.truncated).toBe(false);
    });

    it("still reads dates when the file states no money at all", async () => {
      // The reason the registry's spine is the date and not the sum: a corpus with no extractable
      // amounts still yields a usable chronology. A money-spined view would render blank.
      serve(
        [
          chunk({
            id: "c-dry",
            document_id: "doc-dry",
            content: "Jugement prononcé le 19 décembre 2019."
          })
        ],
        ["doc-dry"]
      );

      const story = await read();

      expect(story.facts).toHaveLength(1);
      expect(story.facts[0].milestones).toEqual(["jugement"]);
      expect(story.facts[0].amounts).toEqual([]);
      expect(story.undatedDocumentIds).toEqual([]);
    });
  });
});

describe("excerptAround", () => {
  it("returns characters the content contains, trimmed to whole words", () => {
    const content = `${"a ".repeat(200)}la donation du 5 janvier 1992 ${"b ".repeat(200)}`;

    const excerpt = excerptAround(content, 400, 429);

    expect(content).toContain(excerpt);
    expect(excerpt.startsWith("a ")).toBe(true);
  });

  it("does not run off either end of a short chunk", () => {
    expect(excerptAround("Acte du 3 mars 2003.", 8, 19)).toBe(
      "Acte du 3 mars 2003."
    );
  });
});
