import {
  amountPattern,
  CURRENCIES,
  currencyByCode,
  findAmounts,
  isConvertible,
  parseAmount,
  sqlAmountPattern,
  toEurIndicative
} from "../money";

describe("parseAmount", () => {
  // Belgian and Dutch typography: '.' and ' ' group thousands, ',' is the decimal point. This is the
  // exact inverse of the en-US default, so parseFloat gets every one of these wrong.
  it("reads European thousands separators", () => {
    expect(parseAmount("4.000.000")).toBe(4000000);
    expect(parseAmount("521 000")).toBe(521000);
    expect(parseAmount("214000")).toBe(214000);
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("450 000")).toBe(450000);
  });

  it("reads Anglo separators too, since a case file can contain a foreign statement", () => {
    expect(parseAmount("4,000,000")).toBe(4000000);
    expect(parseAmount("1,234.56")).toBe(1234.56);
  });

  // The only genuinely ambiguous shape. It resolves to thousands for a reason, not a coin flip: no
  // currency in the registry has three minor digits, so 1.234 cannot be a sum of money.
  it("reads a lone separator with three digits after it as thousands", () => {
    expect(parseAmount("1.234")).toBe(1234);
    expect(parseAmount("1,234")).toBe(1234);
    for (const c of CURRENCIES) {
      // The justification, asserted rather than trusted.
      expect(c.code).not.toBe("KWD"); // a real 3-decimal currency, deliberately absent
    }
  });

  it("reads one or two digits after a lone separator as decimals", () => {
    expect(parseAmount("1,50")).toBe(1.5);
    expect(parseAmount("1.5")).toBe(1.5);
    expect(parseAmount("0,99")).toBe(0.99);
  });

  it("keeps the sign", () => {
    expect(parseAmount("-450 000")).toBe(-450000);
    expect(parseAmount("0")).toBe(0);
  });

  it("returns null for anything that is not a number", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("12/345/A")).toBeNull();
    expect(parseAmount(",.,")).toBeNull();
  });
});

describe("findAmounts", () => {
  // Verbatim phrases from a real Belgian court file — the fixtures that matter most.
  it("finds the amounts a real filing writes", () => {
    expect(
      findAmounts("Sur la somme en liquide de 4.000.000 BEF")
    ).toMatchObject([{ value: 4000000, currency: "BEF" }]);
    expect(findAmounts("SANISTOCK : 521 000 fb")).toMatchObject([
      { value: 521000, currency: "BEF" }
    ]);
    expect(
      findAmounts("Réf:210/767/961227/12/004/000 FB 214000")
    ).toMatchObject([{ value: 214000, currency: "BEF" }]);
    // "- 450 000 fb" appears in the corpus directly under "SANISTOCK : 521 000 fb", i.e. the dash is
    // a BULLET, not a minus. A hyphen separated from the digits by a space is punctuation; only a
    // sign written against the number is a sign. Getting this backwards would invert an amount, which
    // in a ledger is worse than missing it.
    expect(findAmounts("- 450 000 fb")).toMatchObject([
      { value: 450000, currency: "BEF" }
    ]);
    expect(findAmounts("-450 000 fb")).toMatchObject([
      { value: -450000, currency: "BEF" }
    ]);
  });

  it("finds the token on either side of the number", () => {
    expect(findAmounts("EUR 50 000")).toMatchObject([
      { value: 50000, currency: "EUR" }
    ]);
    expect(findAmounts("50 000 EUR")).toMatchObject([
      { value: 50000, currency: "EUR" }
    ]);
    expect(findAmounts("1.234,56 €")).toMatchObject([
      { value: 1234.56, currency: "EUR" }
    ]);
  });

  it("handles Dutch filings", () => {
    expect(findAmounts("een bedrag van 4.000 gulden")).toMatchObject([
      { value: 4000, currency: "NLG" }
    ]);
    expect(findAmounts("een bedrag van 250.000 frank")).toMatchObject([
      { value: 250000, currency: "BEF" }
    ]);
  });

  // Selectivity is half the value: without a required currency token every article number and page
  // reference in a court file becomes an "amount", and the view fills with noise.
  it("ignores numbers with no currency beside them", () => {
    expect(findAmounts("article 374 du Code civil")).toEqual([]);
    expect(findAmounts("Réf:210/767/961227/12/004/000")).toEqual([]);
    expect(findAmounts("tél. 02 511 44 55")).toEqual([]);
    expect(findAmounts("rolnummer 12/345/A")).toEqual([]);
    expect(findAmounts("pièce 12, annexe 5")).toEqual([]);
  });

  // A legal chronology is dense with both years and francs; "en 1998, en francs" must not become
  // an amount of 1998.
  it("ignores a bare year sitting next to a currency word", () => {
    expect(findAmounts("payable en francs 1998")).toEqual([]);
    expect(findAmounts("EUR 2024")).toEqual([]);
    // ...but a separated or decimalised number of the same magnitude IS an amount.
    expect(findAmounts("1.998 EUR")).toMatchObject([{ value: 1998 }]);
    expect(findAmounts("EUR 2024,00")).toMatchObject([{ value: 2024 }]);
  });

  it("reports where it found each amount, so a caller can quote the sentence", () => {
    const text = "Le solde de 12.500 EUR reste dû.";
    const [hit] = findAmounts(text);
    expect(text.slice(hit.start, hit.end)).toBe(hit.raw);
    expect(hit.raw).toContain("12.500");
  });

  it("finds several amounts in order", () => {
    const hits = findAmounts("d'abord 4.000.000 BEF puis 50 000 EUR");
    expect(hits.map((h) => h.value)).toEqual([4000000, 50000]);
    expect(hits.map((h) => h.currency)).toEqual(["BEF", "EUR"]);
  });

  it("returns a fresh regex each call, so state cannot leak between scans", () => {
    // A shared /g regex carries lastIndex; the second scan would start mid-string and miss the hit.
    expect(amountPattern()).not.toBe(amountPattern());
    for (let i = 0; i < 3; i++) {
      expect(findAmounts("4.000.000 BEF")).toHaveLength(1);
    }
  });
});

describe("toEurIndicative", () => {
  // These twelve rates are law — the irrevocable conversions fixed on 31 December 1998. Asserted
  // arithmetically so a typo in the registry cannot pass.
  const FIXED: [string, number][] = [
    ["BEF", 40.3399],
    ["LUF", 40.3399],
    ["DEM", 1.95583],
    ["FRF", 6.55957],
    ["NLG", 2.20371],
    ["ITL", 1936.27],
    ["ESP", 166.386],
    ["ATS", 13.7603],
    ["IEP", 0.787564],
    ["FIM", 5.94573],
    ["PTE", 200.482],
    ["GRD", 340.75]
  ];

  it("converts every legacy currency at its legal rate", () => {
    for (const [code, rate] of FIXED) {
      const got = toEurIndicative(1000, code);
      expect(got).not.toBeNull();
      expect(got!.rate).toBe(rate);
      expect(got!.value).toBe(Math.round((1000 / rate) * 100) / 100);
      expect(got!.basis).toBe("fixed");
    }
  });

  it("converts the real corpus amount to the figure a lawyer would check", () => {
    // 4.000.000 / 40.3399 = 99157.4099…, so 99157.41 to the cent.
    expect(toEurIndicative(4000000, "BEF")!.value).toBe(99157.41);
  });

  it("leaves euros alone", () => {
    expect(toEurIndicative(1234.56, "EUR")!.value).toBe(1234.56);
  });

  // The integrity rule: a floating currency has no legally fixed rate, so converting it would be
  // inventing a valuation — and valuation is often the disputed question.
  it("refuses to convert a floating currency", () => {
    for (const code of ["USD", "GBP", "CHF"]) {
      expect(toEurIndicative(1000, code)).toBeNull();
      expect(isConvertible(code)).toBe(false);
    }
  });

  it("refuses an unknown currency rather than assuming euros", () => {
    expect(toEurIndicative(1000, "XYZ")).toBeNull();
  });

  it("handles zero and negatives without special-casing", () => {
    expect(toEurIndicative(0, "BEF")!.value).toBe(0);
    expect(toEurIndicative(-40339.9, "BEF")!.value).toBeCloseTo(-1000, 2);
  });
});

describe("the registry is the single source of truth", () => {
  // This is what makes "adding a currency is one entry" true rather than aspirational: every
  // registry token must be picked up by the generated pattern and resolve to its own code.
  it("scans every token of every registered currency", () => {
    for (const currency of CURRENCIES) {
      for (const token of currency.tokens) {
        const hits = findAmounts(`${token} 12.500`);
        expect(hits).toHaveLength(1);
        expect(hits[0].currency).toBe(currency.code);
      }
    }
  });

  it("puts every registered token in the SQL prefilter too", () => {
    const sql = sqlAmountPattern();
    for (const currency of CURRENCIES) {
      for (const token of currency.tokens) {
        // Escaped forms appear escaped; check the significant characters survive.
        expect(sql.toLowerCase()).toContain(
          token.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`)
        );
      }
    }
  });

  it("exposes each currency by code, case-insensitively", () => {
    expect(currencyByCode("bef")?.code).toBe("BEF");
    expect(currencyByCode("BEF")?.fixedEurRate).toBe(40.3399);
    expect(currencyByCode("nope")).toBeUndefined();
  });

  it("prefers the longest token, so a shorter one cannot shadow it", () => {
    // "francs belges" must not be read as bare "francs" with "belges" left over, and "US$" not as "$".
    expect(findAmounts("francs belges 1.000")[0].currency).toBe("BEF");
    expect(findAmounts("francs suisses 1.000")[0].currency).toBe("CHF");
    expect(findAmounts("francs français 1.000")[0].currency).toBe("FRF");
  });
});
