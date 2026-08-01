import { findDates, sqlDatePattern } from "../dates";

describe("findDates", () => {
  // Verbatim from the real corpus — the facts that matter are written inside recent filings.
  it("reads the dates a Belgian filing writes out", () => {
    expect(
      findDates("Monsieur Jacques PIRSON est décédé ab intestat le 27 mai 1998")
    ).toMatchObject([
      { iso: "1998-05-27", raw: "27 mai 1998", yearInferred: false }
    ]);
    expect(
      findDates("Le 21 mars 1996, Madame Monique PIRSON a acheté")
    ).toMatchObject([{ iso: "1996-03-21" }]);
    expect(findDates("BRUXELLES, LE 17 novembre 1997.")).toMatchObject([
      { iso: "1997-11-17" }
    ]);
    expect(findDates("La Hulpe, le 4 mai 1998. Chère Madame")).toMatchObject([
      { iso: "1998-05-04" }
    ]);
    expect(
      findDates("note de revendication du 13 novembre 2023 (p. 4)")
    ).toMatchObject([{ iso: "2023-11-13" }]);
  });

  it("handles the ordinal and the accented months", () => {
    expect(findDates("le 1er janvier 2020")[0].iso).toBe("2020-01-01");
    expect(findDates("le 8 février 1999")[0].iso).toBe("1999-02-08");
    expect(findDates("le 8 fevrier 1999")[0].iso).toBe("1999-02-08");
    expect(findDates("le 15 août 2001")[0].iso).toBe("2001-08-15");
    expect(findDates("le 3 décembre 2010")[0].iso).toBe("2010-12-03");
  });

  it("reads Dutch filings", () => {
    expect(findDates("op 27 mei 1998 overleden")[0].iso).toBe("1998-05-27");
    expect(findDates("17 november 1997")[0].iso).toBe("1997-11-17");
    expect(findDates("1 januari 2020")[0].iso).toBe("2020-01-01");
    expect(findDates("15 maart 1996")[0].iso).toBe("1996-03-15");
  });

  it("reads numeric dates day-first, as Belgian filings write them", () => {
    expect(findDates("signé le 27/05/1998")[0].iso).toBe("1998-05-27");
    expect(findDates("acte du 10.07.1958")[0].iso).toBe("1958-07-10");
    expect(findDates("du 31-12-2024")[0].iso).toBe("2024-12-31");
    // 15 cannot be a month, which confirms the order the convention assumes throughout.
    expect(findDates("soit le 15/6/98")[0].iso).toBe("1998-06-15");
  });

  // The document said "98", not "1998". Presenting the century as certain overstates the text.
  it("flags a century it had to infer", () => {
    const [inferred] = findDates("soit le 15/6/98");
    expect(inferred.yearInferred).toBe(true);
    const [stated] = findDates("soit le 15/6/1998");
    expect(stated.yearInferred).toBe(false);
  });

  // A document cites the past. Resolving against the CITING document is both more accurate than a
  // fixed pivot and still deterministic — the reference is data, not a clock.
  it("resolves a two-digit year against the year the document was written", () => {
    expect(findDates("le 01/01/98", { referenceYear: 2024 })[0].iso).toBe(
      "1998-01-01"
    );
    expect(findDates("le 01/01/24", { referenceYear: 2024 })[0].iso).toBe(
      "2024-01-01"
    );
    // The bug a fixed pivot produced on the real corpus: acts dated 2036 in a file whose oldest
    // deeds are from the 1930s. A 1998 letter writing "36" means 1936.
    expect(findDates("le 01/01/36", { referenceYear: 1998 })[0].iso).toBe(
      "1936-01-01"
    );
    expect(findDates("le 01/01/38", { referenceYear: 1998 })[0].iso).toBe(
      "1938-01-01"
    );
  });

  it("never dates an act after the document that cites it", () => {
    for (const two of ["27", "36", "45", "99"]) {
      const [d] = findDates(`le 01/01/${two}`, { referenceYear: 2000 });
      expect(Number(d.iso.slice(0, 4))).toBeLessThanOrEqual(2000);
    }
  });

  it("falls back to a fixed pivot only when the document year is unknown", () => {
    expect(findDates("le 01/01/98")[0].iso).toBe("1998-01-01");
    expect(findDates("le 01/01/24")[0].iso).toBe("2024-01-01");
  });

  it("rejects a date that does not exist", () => {
    // A parse artefact, not a date — 31 February and month 13 must not reach a chronology.
    expect(findDates("le 31/02/1998")).toEqual([]);
    expect(findDates("le 01/13/1998")).toEqual([]);
    expect(findDates("le 32 mai 1998")).toEqual([]);
  });

  it("ignores the reference numbers a court file is full of", () => {
    expect(findDates("Réf:210/767/961227/12/004/000")).toEqual([]);
    expect(findDates("rolnummer 12/345/A")).toEqual([]);
    expect(findDates("article 374 du Code civil")).toEqual([]);
    // A Belgian rôle-général number looks like a date and is not one. It is rejected because its
    // last group is three digits, which no year is — the same boundary rule that keeps a date out of
    // the middle of a longer number.
    expect(findDates("R.G. 19/07/271 CH")).toEqual([]);
    expect(findDates("R.G. 2019/1234/A")).toEqual([]);
  });

  it("does not read a date out of the middle of a longer number", () => {
    expect(findDates("00012/05/19988")).toEqual([]);
  });

  it("counts a written date once, not twice", () => {
    // The numeric pass must not re-match digits already inside a written date.
    expect(findDates("le 17 novembre 1997")).toHaveLength(1);
  });

  it("returns dates in the order they appear, with usable offsets", () => {
    const text = "acheté le 21 mars 1996 puis vendu le 15/6/98.";
    const found = findDates(text);
    expect(found.map((d) => d.iso)).toEqual(["1996-03-21", "1998-06-15"]);
    for (const d of found) expect(text.slice(d.start, d.end)).toBe(d.raw);
  });

  it("is deterministic and carries no state between calls", () => {
    for (let i = 0; i < 3; i++)
      expect(findDates("le 27 mai 1998 et le 4 mai 1998")).toHaveLength(2);
  });

  it("stays inside a plausible range for a case file", () => {
    expect(findDates("le 01/01/1850")).toEqual([]);
    expect(findDates("le 01/01/2150")).toEqual([]);
  });
});

describe("sqlDatePattern", () => {
  it("names every month it can parse, so the prefilter cannot hide one", () => {
    const sql = sqlDatePattern();
    for (const month of [
      "janvier",
      "décembre",
      "januari",
      "december",
      "mei",
      "août"
    ])
      expect(sql).toContain(month);
  });
});
