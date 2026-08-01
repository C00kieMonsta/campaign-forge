import {
  deathTriggerBefore,
  findCrossReferences,
  findLegalTerms,
  foldLegalText,
  LEGAL_TERMS,
  legalTermsInGroup,
  scanLegalText,
  sqlLegalTermPattern,
  termsForSpan
} from "../legalText";

// Passages taken VERBATIM from the real corpus this was built against, plus two files invented for
// other disputes — a divorce and a commercial claim — so nothing is fitted to one succession.
const CORPUS = {
  death:
    "4. Monsieur Jacques PIRSON est décédé ab intestat le 27 mai 1998 en laissant pour seuls héritiers",
  deathAtUccle:
    "concernant la succession de feu M. PIRSON Jacques, décédé à Uccle, le 27 mai 1998.",
  donation:
    "la donation des époux Pirson-Sparenberg de 3.450.000 FB consentie le 27 janvier 1998",
  rapportTable:
    "(1/2 de 450.000 BEF 17/12/1991) (1/2 de 1.500.000 BEF 5/1/1992) (934.628 BEF 24/6/1996)",
  reserveWrongSense:
    "le traitement tout particulier qu’elle a réservé et réserve encore et toujours à Madame",
  prescribedByLaw:
    "a) sur le vu des pièces officielles prescrites par la loi, que les nom, prénoms",
  pvOuverture:
    "procès-verbal d'ouverture des opérations de liquidation-partage du 7 octobre 2020",
  etatLiquidatif:
    "l’état liquidatif dressé par le notaire-liquidateur le 31 décembre 2024 (annexe 13)"
};

const DIVORCE =
  "Par jugement du 12 mars 2019, le tribunal de la famille a prononcé le divorce des époux. " +
  "Les parties restent en indivision sur l'immeuble sis à Namur ; une sommation a été signifiée " +
  "le 4 avril 2019 (pièce 7) et l'inventaire a été dressé le 6 mai 2019.";

const DIVORCE_NL =
  "Bij vonnis van 12 maart 2019 werd de echtscheiding uitgesproken. De onverdeeldheid blijft " +
  "bestaan en de boedelbeschrijving werd opgesteld op 6 mei 2019 (stuk 7).";

const COMMERCIAL =
  "Le rapport d'expertise du 14 juin 2021 évalue le fonds de commerce à 250.000 EUR. " +
  "La facture (pièce 12) reste impayée et l'action n'est pas prescrite.";

describe("foldLegalText", () => {
  // Offsets are how an excerpt and a pin cite are cut out of the document. A fold that shifted them
  // by one would quote the wrong sentence, which is the one failure this whole module must not have.
  it("never changes a single offset", () => {
    for (const text of [
      CORPUS.death,
      CORPUS.donation,
      CORPUS.etatLiquidatif,
      DIVORCE,
      DIVORCE_NL,
      "ÉTAT LIQUIDATIF — d’hoirie : 4.000.000 BEF"
    ]) {
      const folded = foldLegalText(text);
      expect(folded).toHaveLength(text.length);
    }
  });

  it("lowercases and normalises the typography extracted PDFs produce", () => {
    expect(foldLegalText("AVANCEMENT D’HOIRIE")).toBe("avancement d'hoirie");
    expect(foldLegalText("notaire‑liquidateur")).toBe("notaire-liquidateur");
    expect(foldLegalText("pièce 5")).toBe("pièce 5");
  });

  // Accents survive the fold on purpose: the asymmetry that separates "réserve" from "réservé" lives
  // in the compiled pattern, and stripping here would destroy the distinction before it is used.
  it("leaves accents alone", () => {
    expect(foldLegalText("RÉSERVE")).toBe("réserve");
  });
});

describe("findLegalTerms", () => {
  const ids = (text: string) => findLegalTerms(text).map((m) => m.termId);

  it("reads the notions a Belgian succession filing uses", () => {
    expect(ids(CORPUS.donation)).toContain("donation");
    expect(ids("la réserve héréditaire des enfants est atteinte")).toContain(
      "reserve"
    );
    expect(ids("les héritiers réservataires demandent la réduction")).toEqual([
      "reserve",
      "reduction"
    ]);
    expect(ids("le rapport des donations en avancement d'hoirie")).toEqual([
      "rapport",
      "donation",
      "avancement-hoirie"
    ]);
    expect(ids("le recel successoral est invoqué")).toContain("recel");
    expect(ids("l'indivision successorale")).toContain("indivision");
    expect(ids("la quotité disponible est d'un quart")).toContain(
      "quotite-disponible"
    );
  });

  it("reads the procedural steps of a judicial liquidation-partage", () => {
    expect(ids(CORPUS.pvOuverture)).toContain("pv-ouverture");
    expect(ids(CORPUS.etatLiquidatif)).toEqual(
      expect.arrayContaining(["etat-liquidatif", "notaire-liquidateur"])
    );
    expect(ids("les contredits doivent être déposés")).toContain("contredits");
    expect(ids("la citation introductive d'instance")).toContain(
      "citation-introductive"
    );
    // One table entry covers both spellings, because a hyphen matches a space.
    expect(ids("le notaire liquidateur a convoqué les parties")).toContain(
      "notaire-liquidateur"
    );
  });

  it("reads a Dutch filing from the same table", () => {
    expect(ids("de schenking met voorbehoud van vruchtgebruik")).toEqual([
      "donation",
      "reserve-usufruit",
      "usufruit"
    ]);
    expect(ids("de inbreng van de giften")).toEqual(["rapport", "liberalite"]);
    expect(ids(DIVORCE_NL)).toEqual(
      expect.arrayContaining(["jugement", "indivision", "inventaire"])
    );
  });

  // THE ASYMMETRIC ACCENT RULE. A term written with an accent matches text that lost it, because
  // extraction does lose accents — but not a different word that happens to fold onto it. Measured:
  // treating "réservé" ("set aside") as "réserve" added 11 documents to the notion's count on the
  // real corpus, every sampled one of them the wrong sense.
  it("matches an unaccented spelling without matching a different word", () => {
    expect(ids("etat liquidatif")).toEqual(["etat-liquidatif"]);
    expect(ids("apercu des revendications")).toEqual(["apercu-revendications"]);
    expect(ids("reserve hereditaire")).toEqual(["reserve"]);
    expect(ids("le sort qui a été réservé aux fonds")).toEqual([]);
    expect(findLegalTerms(CORPUS.reserveWrongSense)).toHaveLength(1);
    expect(findLegalTerms(CORPUS.reserveWrongSense)[0].raw).toBe("réserve");
  });

  // Unbounded tokens produced 26x false positives on this corpus — "Dem" inside "Demandeur" — and
  // extracted text carries base64 blobs from embedded attachments where anything can appear.
  it("never matches inside a longer word", () => {
    expect(ids("la donation est rapportable")).toEqual([
      "donation",
      "rapportable"
    ]);
    expect(ids("rapportable")).toEqual(["rapportable"]);
    expect(ids("Demandeur, défendeur, reserved, gifted, recelé")).toEqual([]);
    expect(ids("R0lGODlhAQABAIAAAAUEBArapportXQAAOw==")).toEqual([]);
  });

  it("survives the line breaks and apostrophes of extracted text", () => {
    expect(ids("procès-\nverbal d'ouverture des opérations")).toContain(
      "pv-ouverture"
    );
    expect(ids("avancement d’hoirie")).toContain("avancement-hoirie");
    expect(ids("nue-\npropriété")).toContain("nue-propriete");
  });

  it("prefers the longest term, so a compound is not also counted as its part", () => {
    expect(ids("quasi-usufruit")).toEqual(["quasi-usufruit"]);
    expect(ids("quasi-usufruit et usufruit")).toEqual([
      "quasi-usufruit",
      "usufruit"
    ]);
  });

  it("returns offsets that cut the original text back out", () => {
    for (const text of [CORPUS.donation, CORPUS.etatLiquidatif, DIVORCE])
      for (const match of findLegalTerms(text))
        expect(text.slice(match.start, match.end)).toBe(match.raw);
  });

  it("orders matches by position and carries no state between calls", () => {
    const text = "la réduction de la donation rapportable";
    const first = findLegalTerms(text);
    const second = findLegalTerms(text);
    expect(first).toEqual(second);
    expect(first.map((m) => m.start)).toEqual(
      [...first.map((m) => m.start)].sort((a, b) => a - b)
    );
  });

  it("scans only the groups it is asked for", () => {
    expect(
      findLegalTerms(CORPUS.etatLiquidatif, ["milestone"]).map((m) => m.termId)
    ).toEqual(["etat-liquidatif", "notaire-liquidateur"]);
    expect(findLegalTerms(CORPUS.donation, ["milestone"])).toEqual([]);
  });

  // Two files from other disputes, to keep the vocabulary honest outside a succession.
  it("reads a divorce file without inventing succession vocabulary", () => {
    const found = ids(DIVORCE);
    expect(found).toEqual(
      expect.arrayContaining([
        "jugement",
        "indivision",
        "sommation",
        "inventaire"
      ])
    );
    expect(found).not.toContain("donation");
    expect(found).not.toContain("recel");
  });

  it("reads a commercial file, including the one overlap that is real", () => {
    // "rapport d'expertise" IS matched by the "rapport" notion. That is a deliberate limitation, not
    // an oversight: the caption says the word was found near the date, and narrowing the term to
    // "rapport successoral" would miss "doit le rapport de", which is how the filings write it.
    expect(ids(COMMERCIAL)).toEqual(["rapport"]);
  });

  it("does not read the extinctive sense into 'prescrit par la loi'", () => {
    expect(ids(CORPUS.prescribedByLaw)).toEqual([]);
    expect(ids("l'action est prescrite depuis 2020")).toEqual([]);
    expect(ids("la prescription trentenaire")).toEqual(["prescription"]);
  });
});

describe("findCrossReferences", () => {
  const raws = (text: string) => findCrossReferences(text).map((r) => r.raw);

  it("reads an exhibit reference in both languages, exactly as written", () => {
    expect(raws("voir pièce 1, annexe 13, stuk 2 et bijlage 4")).toEqual([
      "pièce 1",
      "annexe 13",
      "stuk 2",
      "bijlage 4"
    ]);
    expect(raws("annexes 3 et 4")).toEqual(["annexes 3"]);
    expect(raws("pièce n° 12")).toEqual(["pièce n° 12"]);
    expect(raws("pièce 1.5.")).toEqual(["pièce 1.5"]);
    expect(raws("pièce 21).")).toEqual(["pièce 21"]);
  });

  it("needs a number: a reference is a citation, not the word", () => {
    expect(raws("les pièces produites par la partie adverse")).toEqual([]);
    expect(raws("en annexe le courrier du 3 mars")).toEqual([]);
    expect(raws("pièces convaincantes")).toEqual([]);
  });

  // A wrong pièce number in conclusions filed under art. 744 is worse than none, so an amount must
  // never be read as one.
  it("does not read a thousands-separated amount as a reference number", () => {
    expect(raws("les pièces 3.450.000 FB")).toEqual([]);
    expect(raws("pièce 1.500.000")).toEqual([]);
  });

  it("keeps offsets and collapses whitespace only in the label", () => {
    const text = "voir\nannexe\n13 du dossier";
    const [ref] = findCrossReferences(text);
    expect(text.slice(ref.start, ref.end)).toBe("annexe\n13");
    expect(ref.raw).toBe("annexe 13");
  });
});

describe("deathTriggerBefore", () => {
  const at = (text: string, needle: string) =>
    deathTriggerBefore(text, text.indexOf(needle));

  it("reads the forms the corpus actually writes", () => {
    expect(at(CORPUS.death, "27 mai 1998")).toMatchObject({
      anchorId: "decede-le",
      raw: "décédé ab intestat le"
    });
    expect(at(CORPUS.deathAtUccle, "27 mai 1998")!.raw).toBe(
      "décédé à Uccle, le"
    );
    expect(
      at("de feu Monsieur Jacques PIRSON, décédé le 27 mai 1998.", "27 mai")!
        .raw
    ).toBe("décédé le");
    expect(at("date du décès : 27 mai 1998", "27 mai")!.raw).toBe(
      "date du décès :"
    );
    expect(
      at("de erflater is overleden op 27 mei 1998", "27 mei")
    ).toMatchObject({ anchorId: "overleden-op" });
  });

  // THE MEASURED FALSE POSITIVE. A looser rule — any death word within 80 characters — returned 45
  // distinct dates on the real corpus and tagged the 1958 marriage contract as a death, because "feu
  // Monsieur Jacques PIRSON" sits beside it. The date of death decides which succession law governs
  // the whole file, so this pattern refuses everything it is not sure of.
  it("refuses a death word that is not the trigger of THIS date", () => {
    expect(
      at("jusqu'au décès de son père Etienne le 25 avril 1989", "25 avril")
    ).toBeNull();
    expect(
      at("Feu Monsieur Jacques PIRSON, né le 19 mars 1928", "19 mars")
    ).toBeNull();
    expect(
      at(
        "entre le 6 mai 1998 et le 27 mai 1998, date du décès de Monsieur",
        "27 mai"
      )
    ).toBeNull();
    expect(at("atteste qu'au 27/05/1998 date du décès de", "27/05")).toBeNull();
    // The trigger must END at the date, not merely be in the same neighbourhood.
    expect(
      at(
        "date du décès de Monsieur PIRSON, l'immeuble a été vendu le 3 mars 1999",
        "3 mars"
      )
    ).toBeNull();
    // A second date in the same sentence does not inherit the first one's trigger.
    expect(
      at(
        "décédé le 27 mai 1998 ; l'inventaire a été dressé le 13 septembre 2023",
        "13 septembre"
      )
    ).toBeNull();
    // The intervening text is bounded: past a clause, the "le" is a different sentence's article.
    expect(
      at(
        "décédé, sa succession a été ouverte par le tribunal le 3 mars 2019",
        "3 mars"
      )
    ).toBeNull();
  });

  it("gives the document's own words, at their own offset", () => {
    const trigger = at(CORPUS.deathAtUccle, "27 mai 1998")!;
    expect(CORPUS.deathAtUccle.slice(trigger.start, trigger.start + 6)).toBe(
      "décédé"
    );
  });
});

describe("termsForSpan", () => {
  const scan = (text: string) => scanLegalText(text);

  it("attaches what is near the date and drops what is not", () => {
    const text = `La donation litigieuse est décrite ci-après. ${"x".repeat(400)} 27 mai 1998`;
    const { terms, refs } = scan(text);
    const dateStart = text.indexOf("27 mai 1998");
    const near = termsForSpan(terms, refs, dateStart, dateStart + 11);
    expect(near.notions).toEqual([]);
    const wide = termsForSpan(terms, refs, dateStart, dateStart + 11, {
      radius: 500
    });
    expect(wide.notions).toEqual(["donation"]);
  });

  // Asymmetric on purpose: "procès-verbal d'ouverture des opérations du 7 octobre 2020" names its own
  // date, but a milestone word after the date belongs to the next sentence. Measured, the top-ranked
  // date for each of six milestones was the right one, 6 times out of 6.
  it("reads a milestone only before the date, and only close to it", () => {
    const text = CORPUS.pvOuverture;
    const dateStart = text.indexOf("7 octobre 2020");
    const { terms, refs } = scan(text);
    expect(
      termsForSpan(terms, refs, dateStart, dateStart + 14).milestones
    ).toEqual(["pv-ouverture"]);

    const after = "le 7 octobre 2020, procès-verbal d'ouverture des opérations";
    const afterScan = scan(after);
    expect(
      termsForSpan(afterScan.terms, afterScan.refs, 3, 17).milestones
    ).toEqual([]);

    const far = `procès-verbal d'ouverture ${"x".repeat(200)} le 7 octobre 2020`;
    const farScan = scan(far);
    const farStart = far.indexOf("7 octobre");
    expect(
      termsForSpan(farScan.terms, farScan.refs, farStart, farStart + 14)
        .milestones
    ).toEqual([]);
  });

  it("returns references literally, deduplicated, first appearance first", () => {
    const text =
      "le 31 décembre 2024 (annexe 13), voir aussi annexe 13 et pièce 1";
    const { terms, refs } = scan(text);
    const context = termsForSpan(terms, refs, 3, 19);
    expect(context.refs).toEqual(["annexe 13", "pièce 1"]);
  });

  it("orders ids the way the chips render, whatever order the text used", () => {
    const text = "réduction, donation, usufruit le 5 janvier 1992";
    const { terms, refs } = scan(text);
    const start = text.indexOf("5 janvier");
    // Table order: donation, usufruit, réduction — not the order of appearance.
    expect(termsForSpan(terms, refs, start, start + 15).notions).toEqual([
      "donation",
      "usufruit",
      "reduction"
    ]);
  });

  it("splits the three vocabularies, so nothing reads as a qualification", () => {
    const text = "donation rapportable, état liquidatif du 31 décembre 2024";
    const { terms, refs } = scan(text);
    const start = text.indexOf("31 décembre");
    const context = termsForSpan(terms, refs, start, start + 16);
    expect(context.notions).toEqual(["donation"]);
    expect(context.qualifications).toEqual(["rapportable"]);
    expect(context.milestones).toEqual(["etat-liquidatif"]);
  });
});

describe("scanLegalText", () => {
  it("returns exactly what the two entry points return separately", () => {
    const scan = scanLegalText(CORPUS.etatLiquidatif);
    expect(scan.terms).toEqual(findLegalTerms(CORPUS.etatLiquidatif));
    expect(scan.refs).toEqual(findCrossReferences(CORPUS.etatLiquidatif));
  });
});

describe("sqlLegalTermPattern", () => {
  /** Postgres ARE → JavaScript, for the constructs this pattern is allowed to use. */
  const asJs = (pattern: string) =>
    new RegExp(
      pattern
        .replace(/\[\[:space:\]/g, "[\\s")
        .replace(/\\M/g, "(?![\\p{L}\\p{N}])"),
      "iu"
    );

  // THE PROPERTY THAT MATTERS. A prefilter may read a row it did not need to; it must never hide one.
  it("selects every form the scanner can find, accented or not", () => {
    const sql = asJs(sqlLegalTermPattern());
    for (const term of LEGAL_TERMS) {
      for (const form of [...term.fr, ...term.nl]) {
        // The plainest sentence containing the form: strip the optional-group syntax the table uses.
        const written = form.replace(/[()…]/g, (c) => (c === "…" ? " " : ""));
        const sentence = `Le dossier mentionne ${written} à la page 4.`;
        expect(findLegalTerms(sentence).map((m) => m.termId)).toContain(
          term.id
        );
        expect(sql.test(sentence)).toBe(true);
        // And the same sentence after extraction lost its accents.
        const unaccented = sentence.normalize("NFD").replace(/\p{M}/gu, "");
        if (findLegalTerms(unaccented).some((m) => m.termId === term.id))
          expect(sql.test(unaccented)).toBe(true);
      }
    }
  });

  it("selects every fixture the scanner finds anything in", () => {
    const sql = asJs(sqlLegalTermPattern());
    for (const text of [
      ...Object.values(CORPUS),
      DIVORCE,
      DIVORCE_NL,
      COMMERCIAL
    ]) {
      if (findLegalTerms(text).length > 0) expect(sql.test(text)).toBe(true);
    }
  });

  it("narrows to the groups it is given", () => {
    const milestones = asJs(sqlLegalTermPattern(["milestone"]));
    expect(milestones.test("l'état liquidatif")).toBe(true);
    expect(milestones.test("la donation litigieuse")).toBe(false);
  });
});

describe("the tables themselves", () => {
  it("gives every term both languages and a unique id", () => {
    const ids = new Set<string>();
    for (const term of LEGAL_TERMS) {
      expect(term.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(term.id)).toBe(false);
      ids.add(term.id);
      expect(term.fr.length).toBeGreaterThan(0);
      expect(term.nl.length).toBeGreaterThan(0);
    }
  });

  it("groups the vocabulary the way the control bar renders it", () => {
    expect(legalTermsInGroup("notion").map((t) => t.id)).toEqual([
      "donation",
      "rapport",
      "usufruit",
      "reserve",
      "reduction",
      "indivision",
      "recel",
      "prescription",
      "quotite-disponible",
      "quasi-usufruit"
    ]);
    expect(legalTermsInGroup("qualification").length).toBeGreaterThan(0);
    expect(legalTermsInGroup("milestone").length).toBeGreaterThan(0);
  });
});
