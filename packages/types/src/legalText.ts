// Reading the LEGAL VOCABULARY out of a document's text, deterministically.
//
// Sibling of money.ts and dates.ts, and built on the same discipline: a DATA TABLE of terms, one
// generated pattern, and nothing generated or inferred. Every result is a substring the document
// contains, returned with the offsets that let a caller quote the sentence around it.
//
// WHAT THIS IS FOR. A date on its own says when; it does not say what the passage is about. The
// registry needs to show, beside each date, which words the file itself uses near it — "donation",
// "usufruit", "état liquidatif" — so a practitioner can filter seventy years of filings down to the
// operation she is arguing about. The words are hers, not ours.
//
// WHAT IT MUST NEVER BE READ AS. A term found near a date says the WORD IS THERE and nothing more.
// It does not say the liberality is rapportable, that a réserve is breached, or that anyone concealed
// anything: those are readings of the act, of any pacte adjoint and of later conventions, and Belgian
// law requires a dispense de rapport to be established "de manière certaine". Every caller labels
// these "termes relevés dans le texte" and never as a qualification. Nothing here attributes a ROLE
// or a direction of payment either — that is the contested question in the disputes this app serves.
//
// ADDING A TERM IS ONE ENTRY IN A TABLE, in French AND Dutch. The scanning patterns, the display
// order and the SQL prefilter all derive from the tables; specs assert that, so the claim cannot rot.

// ---------------------------------------------------------------------------------------------
// Folding: matching text that was typed with accents, apostrophes and PDF line breaks
// ---------------------------------------------------------------------------------------------

/**
 * Characters extracted text uses that are the same character for matching purposes.
 *
 * Each mapping is ONE code unit to ONE code unit, because offsets must survive folding — see
 * foldLegalText. The typographic apostrophe is the one that actually bites: the corpus writes
 * "d’hoirie" and "l’usufruit" with U+2019 throughout, so a table entry typed with a plain
 * apostrophe would match nothing at all.
 */
const CHAR_FOLD: Readonly<Record<string, string>> = {
  "’": "'", // ’ right single quotation mark
  "‘": "'", // ‘
  ʼ: "'", // ʼ modifier letter apostrophe
  " ": " ", // no-break space
  "–": "-", // – en dash
  "—": "-", // — em dash
  "‑": "-" // ‑ non-breaking hyphen
};

const HAS_FOLDABLE = new RegExp(
  `[^\\x00-\\x7F]|[${Object.keys(CHAR_FOLD).join("")}]`
);
const FOLDABLE = new RegExp(`[${Object.keys(CHAR_FOLD).join("")}]`, "g");

/**
 * Lowercases and normalises typography WITHOUT changing any offset — and WITHOUT touching accents.
 *
 * Two decisions are packed in here, and both are load-bearing.
 *
 * OFFSETS SURVIVE. The usual one-liner — `text.normalize("NFD").replace(/\p{M}/gu, "")` — cannot be
 * used: NFD makes "é" two code units and the strip makes it one again, so every offset after the
 * first accented letter shifts. This module returns offsets into the CALLER's string; the excerpt and
 * the pin cite are cut with them, so a shifted offset is a misquoted document. Whole-string
 * `toLowerCase` is length-preserving for every character a Belgian filing contains, and the rare
 * exception (Turkish "İ" lowercases to two units) is caught by the length check and left alone.
 *
 * ACCENTS ARE NOT STRIPPED HERE; they are handled asymmetrically on the PATTERN side, where an
 * accented letter in a table entry matches its unaccented counterpart but not the reverse. Stripping
 * both sides was measured and rejected: it made "réserve" match "réservé", and "réservé" in French
 * means "set aside", not the réserve héréditaire. On the real corpus that one collision added 11
 * documents to the notion's count, every sample of it the wrong sense.
 *
 * Text that arrives in NFD (a decomposed "é") will simply not match — a miss, never a wrong citation.
 * The dev corpus contains no combining marks at all, so this is a latent limit rather than a live one.
 */
export function foldLegalText(text: string): string {
  const lowered = text.toLowerCase();
  if (lowered.length !== text.length) return foldPerCharacter(text);
  if (!HAS_FOLDABLE.test(lowered)) return lowered;
  return lowered.replace(FOLDABLE, (ch) => CHAR_FOLD[ch] ?? ch);
}

/** The offset-safe fallback for a string whose case folding changes its length. */
function foldPerCharacter(text: string): string {
  let out = "";
  for (const ch of text) {
    const lowered = CHAR_FOLD[ch] ?? ch.toLowerCase();
    out += lowered.length === ch.length ? lowered : ch;
  }
  return out;
}

/**
 * Every lowercase letter an accented character can stand for: "é" → "eéèêë…".
 *
 * Derived from Unicode decomposition rather than hand-listed, because a hand-listed table is exactly
 * what goes stale. Used in both directions of the asymmetric rule: a table entry's "é" compiles to
 * this class, so it matches a document that writes "reserve" as well as one that writes "réserve",
 * while a table entry's plain "e" compiles to a literal and cannot match "é".
 */
const ACCENT_VARIANTS: ReadonlyMap<string, string> = (() => {
  const variants = new Map<string, string[]>();
  for (let cp = 0x00c0; cp <= 0x024f; cp++) {
    const ch = String.fromCodePoint(cp).toLowerCase();
    if (ch.length !== 1) continue;
    const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
    if (base.length !== 1 || !/[a-z]/.test(base) || base === ch) continue;
    const list = variants.get(base) ?? [base];
    if (!list.includes(ch)) list.push(ch);
    variants.set(base, list);
  }
  return new Map(
    [...variants.entries()].map(([base, list]) => [base, list.join("")])
  );
})();

/** The base letter of an accented character, or null when it is not one. */
function accentBase(ch: string): string | null {
  const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
  if (base.length !== 1 || base === ch || !/[a-z]/.test(base)) return null;
  return base;
}

// ---------------------------------------------------------------------------------------------
// The tables
// ---------------------------------------------------------------------------------------------

/**
 * The three vocabularies, kept apart because they answer different questions and are matched by
 * different rules.
 *
 *  - `notion`        what area of law the passage is in ("donation", "réserve", "recel").
 *  - `qualification` the words that decide how a liberality is treated ("par préciput et hors part",
 *                    "avec réserve d'usufruit"). Presence only — never a conclusion.
 *  - `milestone`     a step in the judicial liquidation-partage ("état liquidatif", "contredits"),
 *                    which is what makes a date beside it a procedural date rather than an act date.
 */
export type LegalTermGroup = "notion" | "qualification" | "milestone";

export const LEGAL_TERM_GROUPS: readonly LegalTermGroup[] = [
  "notion",
  "qualification",
  "milestone"
];

/**
 * One term, in the two languages a Belgian file is written in.
 *
 * FORM SYNTAX, deliberately tiny, and every piece of it earns its place on real text:
 *  - `(x)`   an optional literal — "donation(s)" is one entry rather than two, "décédé(e)(s)" one
 *            rather than four.
 *  - a space or a hyphen matches ANY run of spaces and hyphens, because extracted PDF text breaks
 *            words across lines ("procès-\nverbal") and writes "notaire-liquidateur" both ways.
 *  - `…`     up to a bounded run of intervening text; used only by the death anchors below, where
 *            the corpus writes "décédé à Uccle, le 27 mai 1998" and "décédé ab intestat le …".
 * Everything else is a literal, matched case- and accent-insensitively via foldLegalText.
 */
export interface LegalTerm {
  /** Stable identifier: the UI's translation key and the filter chip's value. Never displayed raw. */
  id: string;
  group: LegalTermGroup;
  /** How a French filing writes it. */
  fr: readonly string[];
  /** How a Dutch filing writes it. Belgian practice, not Netherlands usage. */
  nl: readonly string[];
}

/**
 * The vocabularies, IN DISPLAY ORDER — the chips render in this order, so the table is the single
 * place that decides it.
 *
 * Counts measured on the flagship corpus (documents containing the word) are given where they are
 * informative, because the thin entries are as much of a finding as the fat ones: "quotité
 * disponible" in 2 documents and "quasi-usufruit" in 1 says where the file is argumentatively silent.
 */
export const LEGAL_TERMS: readonly LegalTerm[] = [
  // ── Notions ──────────────────────────────────────────────────────────────────────────────
  {
    id: "donation",
    group: "notion",
    fr: ["donation(s)"],
    nl: ["schenking(en)"]
  },
  // Bare "rapport" also catches "rapport d'expertise". That is accepted rather than patched: the
  // caption says the word was found near the date, and narrowing it to "rapport successoral" would
  // miss the form the filings actually use ("doit le rapport de").
  { id: "rapport", group: "notion", fr: ["rapport"], nl: ["inbreng"] },
  {
    id: "usufruit",
    group: "notion",
    fr: ["usufruit(s)"],
    nl: ["vruchtgebruik"]
  },
  {
    id: "reserve",
    group: "notion",
    fr: ["réserve(s)", "réservataire(s)"],
    nl: ["voorbehouden erfdeel", "reservatair(en)", "reserve"]
  },
  {
    id: "reduction",
    group: "notion",
    fr: ["réduction(s)"],
    nl: ["inkorting(en)"]
  },
  {
    id: "indivision",
    group: "notion",
    fr: ["indivision"],
    nl: ["onverdeeldheid"]
  },
  {
    id: "recel",
    group: "notion",
    fr: ["recel"],
    nl: ["heling", "verzwijging"]
  },
  // "prescrit(e)(s)" is deliberately absent from the French forms. Measured on the corpus it fires on
  // "les pièces officielles prescrites par la loi", "dans les délais prescrits" and "titres réguliers
  // et non prescrits" — the "laid down by law" sense, not the extinctive one — taking the count from
  // 4 documents to 12. The Dutch "verjaard" has no such second meaning and stays.
  {
    id: "prescription",
    group: "notion",
    fr: ["prescription(s)"],
    nl: ["verjaring", "verjaard"]
  },
  {
    id: "quotite-disponible",
    group: "notion",
    fr: ["quotité disponible"],
    nl: ["beschikbaar deel"]
  },
  // Listed before "usufruit" in the alternation by length, so "quasi-usufruit" is not also counted as
  // a bare usufruit — see the compiler note on longest-first ordering.
  {
    id: "quasi-usufruit",
    group: "notion",
    fr: ["quasi-usufruit"],
    nl: ["quasi-vruchtgebruik"]
  },

  // ── Qualifications ───────────────────────────────────────────────────────────────────────
  {
    id: "avancement-hoirie",
    group: "qualification",
    fr: ["avancement d'hoirie", "avance d'hoirie"],
    nl: ["voorschot op erfdeel", "voorschot op zijn erfdeel"]
  },
  {
    id: "preciput-hors-part",
    group: "qualification",
    fr: ["préciput", "hors part(s)"],
    nl: ["vooruitmaking", "buiten erfdeel"]
  },
  {
    id: "dispense-rapport",
    group: "qualification",
    fr: ["dispense de rapport", "dispensé(e)(s) de rapport"],
    nl: ["vrijstelling van inbreng", "vrijgesteld van inbreng"]
  },
  {
    id: "rapportable",
    group: "qualification",
    fr: ["rapportable(s)"],
    nl: ["inbrengplichtig"]
  },
  // The art. 918 ancien trigger set. Measured absent from the flagship corpus (zero documents), which
  // is itself worth knowing — it is why the chips render disabled with their count rather than
  // vanishing.
  {
    id: "reserve-usufruit",
    group: "qualification",
    fr: ["réserve d'usufruit", "réservé l'usufruit"],
    nl: ["voorbehoud van vruchtgebruik"]
  },
  {
    id: "nue-propriete",
    group: "qualification",
    fr: ["nue-propriété", "nu-propriétaire(s)"],
    nl: ["blote eigendom", "naakte eigendom"]
  },
  {
    id: "pleine-propriete",
    group: "qualification",
    fr: ["pleine propriété"],
    nl: ["volle eigendom"]
  },
  {
    id: "rente-viagere",
    group: "qualification",
    fr: ["rente viagère"],
    nl: ["lijfrente"]
  },
  // Belgian Dutch practice writes the French term for this one; it is not a translation gap.
  {
    id: "fonds-perdu",
    group: "qualification",
    fr: ["à fonds perdu"],
    nl: ["à fonds perdu"]
  },
  {
    id: "don-manuel",
    group: "qualification",
    fr: ["don manuel", "dons manuels"],
    nl: ["handgift(en)"]
  },
  {
    id: "liberalite",
    group: "qualification",
    fr: ["libéralité(s)"],
    nl: ["gift(en)", "vrijgevigheid"]
  },
  {
    id: "declaration-maintien",
    group: "qualification",
    fr: ["déclaration de maintien"],
    nl: ["verklaring tot behoud"]
  },

  // ── Procedural milestones (art. 1207-1224 C. jud.) ───────────────────────────────────────
  {
    id: "pv-ouverture",
    group: "milestone",
    fr: [
      "procès-verbal d'ouverture",
      "pv d'ouverture",
      "ouverture des opérations"
    ],
    nl: ["proces-verbaal van opening", "opening van de werkzaamheden"]
  },
  {
    id: "inventaire",
    group: "milestone",
    fr: ["inventaire"],
    nl: ["boedelbeschrijving"]
  },
  {
    id: "apercu-revendications",
    group: "milestone",
    fr: ["aperçu des revendications"],
    nl: ["overzicht van de aanspraken"]
  },
  {
    id: "etat-liquidatif",
    group: "milestone",
    fr: ["état liquidatif", "état de liquidation"],
    nl: ["staat van vereffening"]
  },
  {
    id: "contredits",
    group: "milestone",
    fr: ["contredit(s)"],
    nl: ["zwarigheid", "zwarigheden"]
  },
  {
    id: "citation-introductive",
    group: "milestone",
    fr: ["citation introductive"],
    nl: ["inleidende dagvaarding"]
  },
  {
    id: "jugement",
    group: "milestone",
    fr: ["jugement(s)"],
    nl: ["vonnis(sen)"]
  },
  // One entry covers "notaire-liquidateur" and "notaire liquidateur": a hyphen matches a space.
  {
    id: "notaire-liquidateur",
    group: "milestone",
    fr: ["notaire-liquidateur"],
    nl: ["notaris-vereffenaar"]
  },
  {
    id: "sommation",
    group: "milestone",
    fr: ["sommation(s)"],
    nl: ["aanmaning(en)", "sommatie(s)"]
  },
  {
    id: "declaration-succession",
    group: "milestone",
    fr: ["déclaration de succession"],
    nl: ["aangifte van nalatenschap"]
  }
];

/** Position of each term in LEGAL_TERMS, so results can be returned in display order. */
const TERM_ORDER = new Map(LEGAL_TERMS.map((term, index) => [term.id, index]));

export function legalTermsInGroup(group: LegalTermGroup): readonly LegalTerm[] {
  return LEGAL_TERMS.filter((term) => term.group === group);
}

// ---------------------------------------------------------------------------------------------
// Compiling a form into a pattern
// ---------------------------------------------------------------------------------------------

/** The gap marker's ceiling. "décédé intestat à Uccle, le" is the longest real form: 18 characters. */
const GAP_MAX_CHARS = 24;

/**
 * What a `…` may span: no digits, so a gap can never swallow another date, and no sentence-ending
 * punctuation, so it cannot reach across a clause into an unrelated one.
 */
const GAP_PATTERN = `[^.;:!?\\d]{0,${GAP_MAX_CHARS}}`;

/** A run of spaces or hyphens, which extracted PDF text produces in every combination. */
const SEPARATOR_PATTERN = "[\\s-]+";

/**
 * One character of a table entry, as a pattern.
 *
 * An accented letter becomes the class of everything it can stand for, so one entry covers a filing
 * that writes "état liquidatif" and a scan of a PDF that lost the accent. A plain letter stays a
 * literal, which is the half of the rule that keeps "réservé" out of the réserve count.
 */
function escapeLiteral(ch: string): string {
  const base = accentBase(ch);
  if (base) return `[${ACCENT_VARIANTS.get(base) ?? base}]`;
  return /[\\^$.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch;
}

/** Compiles a (already folded) form body. Recursive only for the optional-group syntax. */
function compileBody(folded: string, source: string): string {
  let out = "";
  let i = 0;
  while (i < folded.length) {
    const ch = folded[i];
    if (ch === "(") {
      const close = folded.indexOf(")", i);
      if (close < 0)
        throw new Error(`legal term form has an unclosed "(": ${source}`);
      out += `(?:${compileBody(folded.slice(i + 1, close), source)})?`;
      i = close + 1;
      continue;
    }
    if (ch === "…") {
      out += GAP_PATTERN;
      i += 1;
      continue;
    }
    if (/[\s-]/.test(ch)) {
      while (i < folded.length && /[\s-]/.test(folded[i])) i += 1;
      out += SEPARATOR_PATTERN;
      continue;
    }
    out += escapeLiteral(ch);
    i += 1;
  }
  return out;
}

/**
 * A form, wrapped so it cannot match inside a longer word.
 *
 * THE BOUNDARIES EXCLUDE DIGITS AS WELL AS LETTERS, for the reason money.ts documents at length:
 * extracted text carries base64 blobs from embedded attachments, where a three-letter token butted
 * against digits looks exactly like a real term. Unbounded matching is how "Dem" once matched
 * "Demandeur" 6041 times in a Belgian family file — every one of them a fabricated figure.
 */
function compileForm(form: string): string {
  const folded = foldLegalText(form);
  const body = compileBody(folded, form);
  const lead = /[\p{L}\p{N}]/u.test(folded[0]) ? "(?<![\\p{L}\\p{N}])" : "";
  return `${lead}${body}(?![\\p{L}\\p{N}])`;
}

interface CompiledGroup {
  regex: RegExp;
  /** Parallel to the regex's capture groups: which term each alternative belongs to. */
  termIds: string[];
}

function compileGroup(group: LegalTermGroup): CompiledGroup {
  const alternatives = LEGAL_TERMS.filter((term) => term.group === group)
    .flatMap((term) =>
      [...term.fr, ...term.nl].map((form) => ({ termId: term.id, form }))
    )
    // LONGEST FIRST. A regex alternation is first-match, not longest-match, so "quasi-usufruit" has
    // to be tried before "usufruit" or the longer term is never seen as itself. Ties break on the
    // term's table position and then the form, so the compiled pattern is byte-identical every run.
    .sort(
      (a, b) =>
        foldLegalText(b.form).length - foldLegalText(a.form).length ||
        (TERM_ORDER.get(a.termId) ?? 0) - (TERM_ORDER.get(b.termId) ?? 0) ||
        (a.form < b.form ? -1 : a.form > b.form ? 1 : 0)
    );
  return {
    regex: new RegExp(
      alternatives.map((a) => `(${compileForm(a.form)})`).join("|"),
      "gu"
    ),
    termIds: alternatives.map((a) => a.termId)
  };
}

const COMPILED = new Map<LegalTermGroup, CompiledGroup>(
  LEGAL_TERM_GROUPS.map((group) => [group, compileGroup(group)])
);

// ---------------------------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------------------------

/** One term found in a document's text. */
export interface TermMatch {
  termId: string;
  group: LegalTermGroup;
  /** The matched text exactly as written — evidence, never a normalised label. */
  raw: string;
  start: number;
  end: number;
}

/**
 * Every term in `text`, in the order it appears.
 *
 * Scan a CHUNK once with this, then use termsForSpan per date: the corpus has 3089 date mentions and
 * re-scanning a window per date would run the vocabulary over the same characters a dozen times.
 */
export function findLegalTerms(
  text: string,
  groups: readonly LegalTermGroup[] = LEGAL_TERM_GROUPS
): TermMatch[] {
  return findLegalTermsFolded(text, foldLegalText(text), groups);
}

function findLegalTermsFolded(
  text: string,
  folded: string,
  groups: readonly LegalTermGroup[]
): TermMatch[] {
  const found: TermMatch[] = [];

  for (const group of groups) {
    const compiled = COMPILED.get(group);
    if (!compiled) continue;
    compiled.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = compiled.regex.exec(folded)) !== null) {
      if (match[0] === "") {
        compiled.regex.lastIndex += 1; // cannot happen with these forms; cheap insurance
        continue;
      }
      const alternative = match.findIndex(
        (value, index) => index > 0 && value !== undefined
      );
      const termId = compiled.termIds[alternative - 1];
      if (!termId) continue;
      found.push({
        termId,
        group,
        raw: text.slice(match.index, match.index + match[0].length),
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }

  return found.sort(
    (a, b) =>
      a.start - b.start ||
      a.end - b.end ||
      (TERM_ORDER.get(a.termId) ?? 0) - (TERM_ORDER.get(b.termId) ?? 0)
  );
}

// ---------------------------------------------------------------------------------------------
// Cross-references: "pièce 5", "annexe 13", "stuk 2"
// ---------------------------------------------------------------------------------------------

/**
 * How a filing names an exhibit, in both languages.
 *
 * These are LITERAL TEXT and stay that way. Art. 1222 §§ 1-2 C. jud. makes a numbered inventory an
 * admissibility condition, but the numbering is per party and per filing and it collides: the corpus
 * has 77 distinct reference strings, and 102 of the 332 occurrences of "annexe 3" come from a single
 * forwarded .eml. Resolving one to a document would put a wrong pièce number into conclusions filed
 * under art. 744, which is strictly worse than resolving none.
 */
const REFERENCE_LABELS: readonly string[] = [
  "pièce(s)",
  "annexe(s)",
  "stuk(ken)",
  "bijlage(n)"
];

/**
 * A number as an inventory writes it: "5", "n° 12", "13a", "B.II.8", "1.5" (the corpus has
 * "pièce 1.5.").
 *
 * The trailing `(?!\.\d)` is what keeps a SUM out of an exhibit citation. Without it "les pièces
 * 3.450.000 FB" yields the reference "pièces 3" — the number stops at the first group and the
 * boundary is satisfied by the dot. Putting a wrong pièce number into conclusions filed under art.
 * 744 is worse than putting none, so an ambiguous run of digits produces nothing at all.
 */
const REFERENCE_NUMBER =
  "(?:n(?:o|°|r)\\.?[\\s]*)?(?:[a-z]\\.[\\s]*)?(?:[ivxl]{1,4}\\.[\\s]*)?\\d{1,3}(?:\\.\\d{1,2})*[a-z]?(?!\\.\\d)";

const REFERENCE_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${REFERENCE_LABELS.map((label) =>
    compileBody(foldLegalText(label), label)
  ).join("|")})${SEPARATOR_PATTERN}${REFERENCE_NUMBER}(?![\\p{L}\\p{N}])`,
  "gu"
);

/** One exhibit reference written in the text. */
export interface CrossReference {
  /** Exactly as written ("pièce B.II.8"). This is what the UI shows; it is never resolved. */
  raw: string;
  /** Folded, whitespace-collapsed, for counting the same reference written two ways. */
  key: string;
  start: number;
  end: number;
}

export function findCrossReferences(text: string): CrossReference[] {
  return findCrossReferencesFolded(text, foldLegalText(text));
}

function findCrossReferencesFolded(
  text: string,
  folded: string
): CrossReference[] {
  const found: CrossReference[] = [];
  REFERENCE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REFERENCE_PATTERN.exec(folded)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    found.push({
      raw: text.slice(start, end).replace(/\s+/g, " "),
      key: match[0].replace(/\s+/g, " "),
      start,
      end
    });
  }
  return found;
}

/** Everything this module reads out of one chunk of text. */
export interface LegalTextScan {
  terms: TermMatch[];
  refs: CrossReference[];
}

/**
 * Both scans over one chunk, folding it ONCE.
 *
 * This is what a per-chunk loop should call. Folding is the expensive half of the work, and the
 * backend's registry pass needs the vocabulary and the exhibit references over the same characters;
 * calling the two entry points separately folds a corpus twice for no reason.
 */
export function scanLegalText(
  text: string,
  groups: readonly LegalTermGroup[] = LEGAL_TERM_GROUPS
): LegalTextScan {
  const folded = foldLegalText(text);
  return {
    terms: findLegalTermsFolded(text, folded, groups),
    refs: findCrossReferencesFolded(text, folded)
  };
}

// ---------------------------------------------------------------------------------------------
// Reading the context of one date
// ---------------------------------------------------------------------------------------------

/**
 * How far either side of a date a notion or a qualification still counts as belonging to it.
 *
 * About a sentence and its neighbour. Measured on the flagship corpus this attaches a notion to 103
 * of 626 dates: most dates carry none, which is the honest answer and is why the caption states it.
 */
export const TERM_WINDOW_RADIUS = 200;

/**
 * A milestone is only read BEFORE the date, and close to it.
 *
 * "procès-verbal d'ouverture des opérations du 7 octobre 2020" names its own date; a milestone word
 * two lines later does not. The asymmetric rule is what makes this the most precise derivation on the
 * page — measured, the top-ranked date for each of six milestones was the right one, 6 times out of 6.
 */
export const MILESTONE_LOOKBEHIND = 120;

export interface SpanContextOptions {
  radius?: number;
  milestoneLookbehind?: number;
}

/** What the text says around one date. Ids and literal references only — never a conclusion. */
export interface SpanContext {
  notions: string[];
  qualifications: string[];
  milestones: string[];
  /** Literal reference strings, first appearance first. */
  refs: string[];
}

/**
 * The terms and references attaching to the span [spanStart, spanEnd) — normally one date mention.
 *
 * Takes the matches found ONCE for the whole chunk, so a chunk with forty dates costs forty window
 * filters rather than forty rescans. Ids come back in table order, which is the order the chips
 * render in, so two facts never disagree about how their badges are arranged.
 */
export function termsForSpan(
  matches: readonly TermMatch[],
  refs: readonly CrossReference[],
  spanStart: number,
  spanEnd: number,
  options: SpanContextOptions = {}
): SpanContext {
  const radius = options.radius ?? TERM_WINDOW_RADIUS;
  const lookbehind = options.milestoneLookbehind ?? MILESTONE_LOOKBEHIND;
  const windowStart = spanStart - radius;
  const windowEnd = spanEnd + radius;

  const inWindow = (start: number, end: number) =>
    start < windowEnd && end > windowStart;

  const collect = (group: LegalTermGroup) => {
    const ids = new Set<string>();
    for (const match of matches) {
      if (match.group !== group) continue;
      const keep =
        group === "milestone"
          ? match.end <= spanStart && spanStart - match.end <= lookbehind
          : inWindow(match.start, match.end);
      if (keep) ids.add(match.termId);
    }
    return [...ids].sort(
      (a, b) => (TERM_ORDER.get(a) ?? 0) - (TERM_ORDER.get(b) ?? 0)
    );
  };

  const seenRefs = new Set<string>();
  const literalRefs: string[] = [];
  for (const ref of refs) {
    if (!inWindow(ref.start, ref.end)) continue;
    if (seenRefs.has(ref.key)) continue;
    seenRefs.add(ref.key);
    literalRefs.push(ref.raw);
  }

  return {
    notions: collect("notion"),
    qualifications: collect("qualification"),
    milestones: collect("milestone"),
    refs: literalRefs
  };
}

// ---------------------------------------------------------------------------------------------
// The death anchor
// ---------------------------------------------------------------------------------------------

/**
 * The phrases that make the date immediately after them a stated date of death.
 *
 * WHY THIS IS SO STRICT. The date of death decides which succession law governs the whole file — the
 * réserve fraction, whether donations are indexed, whether réduction is en nature or en valeur — so a
 * wrong one is the most damaging thing this page could display. A loose rule ("feu|décès|décédé
 * anywhere within 80 characters") was measured: it returned 45 distinct dates and tagged the 1958
 * marriage contract as a death because "feu Monsieur Jacques PIRSON" sits beside it. Requiring the
 * trigger to END immediately before the date returns exactly one date on the same corpus.
 *
 * "décès de X le …" is deliberately ABSENT: it produced the one false positive found in testing — a
 * donation date sitting after "jusqu'au décès de son père Etienne".
 */
interface DeathAnchor {
  id: string;
  lang: "fr" | "nl";
  form: string;
}

const DEATH_ANCHORS: readonly DeathAnchor[] = [
  // The gap absorbs "à Uccle,", "ab intestat" and "intestat à Uccle," — all verbatim corpus forms.
  { id: "decede-le", lang: "fr", form: "décédé(e)(s)… le" },
  { id: "decede-en-date-du", lang: "fr", form: "décédé(e)(s)… en date du" },
  { id: "date-du-deces", lang: "fr", form: "date du décès" },
  { id: "overleden-op", lang: "nl", form: "overleden… op" },
  { id: "datum-van-overlijden", lang: "nl", form: "datum van overlijden" }
];

/** How far back a trigger is looked for. Beyond this the phrase is talking about something else. */
export const DEATH_TRIGGER_LOOKBEHIND = 80;

const COMPILED_DEATH_ANCHORS = DEATH_ANCHORS.map((anchor) => ({
  ...anchor,
  // Anchored to the END of the lookbehind window: the trigger must run right up to the date, give or
  // take two spaces and the colon of "date du décès : 27 mai 1998".
  regex: new RegExp(
    `${compileBody(foldLegalText(anchor.form), anchor.form)}\\s{0,2}(?::\\s{0,2})?$`,
    "u"
  )
}));

/** A death trigger sitting immediately before a date. */
export interface DeathTrigger {
  /** Which table entry fired, for the caller's own diagnostics. */
  anchorId: string;
  /** The trigger exactly as the document writes it. */
  raw: string;
  /** Offset of the trigger in the caller's text. */
  start: number;
}

/**
 * The death trigger immediately preceding `spanStart`, or null.
 *
 * Returns the trigger only. It does NOT say whose succession opened, which régime applies, or what
 * any prescription horizon is: the first is a role (which this app never assigns), and the other two
 * are legal conclusions that depend on facts no pattern can see. The caller shows the quoted sentence
 * and the fixed statutory date of 1 September 2018 side by side, and stops there.
 */
export function deathTriggerBefore(
  text: string,
  spanStart: number,
  lookbehind: number = DEATH_TRIGGER_LOOKBEHIND
): DeathTrigger | null {
  const from = Math.max(0, spanStart - lookbehind);
  const window = foldLegalText(text.slice(from, spanStart));

  let best: { anchorId: string; index: number; length: number } | null = null;
  for (const anchor of COMPILED_DEATH_ANCHORS) {
    const match = anchor.regex.exec(window);
    if (!match) continue;
    // Earliest start wins, so "décédé ab intestat le" is reported rather than a bare tail of it;
    // the table's own order breaks a tie, which keeps the result independent of object iteration.
    if (best === null || match.index < best.index)
      best = {
        anchorId: anchor.id,
        index: match.index,
        length: match[0].length
      };
  }
  if (!best) return null;

  const start = from + best.index;
  return {
    anchorId: best.anchorId,
    raw: text
      .slice(start, start + best.length)
      .replace(/\s+/g, " ")
      .trim(),
    start
  };
}

// ---------------------------------------------------------------------------------------------
// The SQL prefilter
// ---------------------------------------------------------------------------------------------

/**
 * One character of a table entry, as POSIX.
 *
 * Mirrors escapeLiteral exactly — same asymmetric accent rule, same classes — so the prefilter can
 * only ever select MORE rows than the scanner keeps, never fewer. The apostrophe is widened to the
 * three forms extracted text produces, because Postgres sees the document's own bytes while the
 * scanner sees them after foldLegalText has normalised them.
 */
function sqlLiteral(ch: string): string {
  if (ch === "'") return "['’‘]";
  const base = accentBase(ch);
  if (base) return `[${ACCENT_VARIANTS.get(base) ?? base}]`;
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? `\\${ch}` : ch;
}

/**
 * A run of separators as Postgres sees them — before foldLegalText has normalised anything.
 *
 * Derived from CHAR_FOLD so the two cannot drift: every character the scanner treats as a space or a
 * hyphen has to be in this class, or a filing that writes "notaire‑liquidateur" with a non-breaking
 * hyphen would be found by the scanner and hidden by the prefilter.
 */
const SQL_SEPARATOR = `[[:space:]${Object.entries(CHAR_FOLD)
  .filter(([, to]) => to === " " || to === "-")
  .map(([from]) => from)
  .join("")}-]+`;

function sqlForm(form: string): string {
  const folded = foldLegalText(form);
  let out = "";
  let i = 0;
  while (i < folded.length) {
    const ch = folded[i];
    if (ch === "(") {
      const close = folded.indexOf(")", i);
      out += `(${sqlForm(folded.slice(i + 1, close))})?`;
      i = close + 1;
      continue;
    }
    if (ch === "…") {
      out += `.{0,${GAP_MAX_CHARS}}`;
      i += 1;
      continue;
    }
    if (/[\s-]/.test(ch)) {
      while (i < folded.length && /[\s-]/.test(folded[i])) i += 1;
      out += SQL_SEPARATOR;
      continue;
    }
    out += sqlLiteral(ch);
    i += 1;
  }
  return out;
}

/**
 * A POSIX pattern for Postgres's `~*`, generated from the same tables as the scanner.
 *
 * A SUPERSET, deliberately — a prefilter may select a row it did not need to, but must never hide
 * one, and a spec asserts that for every form in every table. It carries only the END-of-word marker
 * (\M) and no leading boundary, for the reason money.ts documents: POSIX has no lookbehind, and a
 * leading \y would reject forms that follow a digit or a hyphen.
 *
 * TODAY'S BACKEND DOES NOT NEED IT. The registry is date-anchored, so the chunks it reads are already
 * shortlisted by the date and amount patterns, and the vocabulary is then read out of the same rows.
 * This exists for a scan that starts from the vocabulary instead — counting a notion across a corpus,
 * say — so that scan cannot be written with a prefilter that silently drops documents.
 */
export function sqlLegalTermPattern(
  groups: readonly LegalTermGroup[] = LEGAL_TERM_GROUPS
): string {
  const forms = LEGAL_TERMS.filter((term) => groups.includes(term.group))
    .flatMap((term) => [...term.fr, ...term.nl])
    .map((form) => `${sqlForm(form)}\\M`);
  return forms.join("|");
}
