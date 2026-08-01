// Building retrieval test cases whose CORRECT ANSWER is derived from the corpus itself.
//
// WHY THIS EXISTS. Every serious defect this app has shipped was in the retrieval path and was
// SILENT: the context assembler took the oldest sixteen messages and dropped the live question;
// pinning page 6 returned a chunk labelled "p. 4"; a one-page PDF handed the model half the page while
// calling it the whole pinned source. None of them threw. Each produced a confident answer built on
// the wrong text. Unit tests cannot catch that class — they prove the plumbing, not that the right
// passage comes back.
//
// WHAT CAN AND CANNOT BE EVALUATED HERE. Three layers, and only two of them have ground truth that
// does not require a lawyer:
//
//   1. RETRIEVAL      — "which documents state 45.500.000 BEF?" is decidable by reading the corpus,
//                       so both the question and its answer are derivable. THIS MODULE.
//   2. CITATION       — a quote in an answer either appears verbatim in the source it cites, or it
//                       does not. Decidable. Checked by the runner.
//   3. CORRECTNESS    — whether the answer is legally right needs the practitioner. NOT decidable
//                       here, and pretending otherwise would be the worst thing this file could do.
//                       verified-cases.json is where her judgement goes; nothing here invents it.
//
// A case is only worth generating when its answer is UNAMBIGUOUS, which is why every generator below
// filters on distinctiveness: a question whose true answer is "forty-one documents" measures nothing.

/** A fact drawn from the corpus, with the documents that state it. */
export interface CorpusFact {
  /** How the fact is written, used verbatim in the question ("45.500.000 BEF", "27 mai 1998"). */
  literal: string;
  documentIds: string[];
}

export type EvalCaseKind = "amount" | "date" | "person";

export interface EvalCase {
  /** Stable across runs so two runs can be diffed. Derived from the kind and the literal. */
  id: string;
  kind: EvalCaseKind;
  /** Asked of the assistant exactly as written. */
  question: string;
  /**
   * Every document that genuinely states the fact. Retrieval is scored on whether it surfaces ANY of
   * these, and on how many — not on returning precisely this set, because a related document is a
   * reasonable thing to also return and penalising it would reward a narrow retriever.
   */
  expectedDocumentIds: string[];
}

/**
 * A fact must appear in at least one and at most this many documents to become a case.
 *
 * The ceiling is what makes the case discriminating. "Which documents mention 1.500.000 BEF?" has
 * eighteen right answers on the real corpus, so almost any retriever scores well and the case detects
 * nothing. A fact in one to three documents has an answer a retriever can actually miss.
 */
const MAX_DOCUMENTS_FOR_A_CASE = 3;

/** Below this the fact is likely an OCR artefact rather than something a filing states. */
const MIN_LITERAL_LENGTH = 4;

function stableId(kind: string, literal: string): string {
  // Not a hash: a readable id makes a failing case self-describing in the report.
  return `${kind}:${literal.replace(/\s+/g, "_").toLowerCase()}`;
}

function distinctive(facts: readonly CorpusFact[]): CorpusFact[] {
  return facts
    .filter(
      (fact) =>
        fact.literal.trim().length >= MIN_LITERAL_LENGTH &&
        fact.documentIds.length >= 1 &&
        fact.documentIds.length <= MAX_DOCUMENTS_FOR_A_CASE
    )
    .map((fact) => ({
      literal: fact.literal.trim(),
      // Deduped and ordered so a case is byte-identical between runs and two reports can be diffed.
      documentIds: [...new Set(fact.documentIds)].sort()
    }))
    .sort((a, b) =>
      a.literal < b.literal ? -1 : a.literal > b.literal ? 1 : 0
    );
}

/**
 * Cases from monetary amounts.
 *
 * The question quotes the amount as the document writes it, which is deliberate: a practitioner
 * searching her own file types the figure she remembers, and the hybrid retriever's full-text half is
 * exactly what should catch it. A regression in the FR/NL tsvector or in the rank fusion shows up
 * here and nowhere else.
 */
export function amountCases(facts: readonly CorpusFact[]): EvalCase[] {
  return distinctive(facts).map((fact) => ({
    id: stableId("amount", fact.literal),
    kind: "amount" as const,
    question: `Dans quelles pièces le montant de ${fact.literal} est-il mentionné, et à quel titre ?`,
    expectedDocumentIds: fact.documentIds
  }));
}

/** Cases from dates written in the documents' text — acts, not filing dates. */
export function dateCases(facts: readonly CorpusFact[]): EvalCase[] {
  return distinctive(facts).map((fact) => ({
    id: stableId("date", fact.literal),
    kind: "date" as const,
    question: `Que disent les pièces au sujet du ${fact.literal} ?`,
    expectedDocumentIds: fact.documentIds
  }));
}

/**
 * Cases from people named in few documents.
 *
 * Deliberately the RARE names, not the recurring parties. "Which documents name Monique Pirson?"
 * answers thirty-eight and tests nothing; a notary appearing in two filings is a real needle.
 */
export function personCases(facts: readonly CorpusFact[]): EvalCase[] {
  return distinctive(facts).map((fact) => ({
    id: stableId("person", fact.literal),
    kind: "person" as const,
    question: `Quelles pièces citent ${fact.literal}, et dans quel contexte ?`,
    expectedDocumentIds: fact.documentIds
  }));
}

export interface BuildCasesInput {
  amounts: readonly CorpusFact[];
  dates: readonly CorpusFact[];
  people: readonly CorpusFact[];
}

/**
 * The generated half of the suite: a balanced, deterministic sample across the three kinds.
 *
 * Balanced on purpose. Drawing purely by rarity would fill the suite with whichever kind happens to
 * have the longest tail — on the real corpus that is dates, 625 of them — and a suite that is 90%
 * date lookups stops measuring the other paths.
 */
export function buildGeneratedCases(
  input: BuildCasesInput,
  perKind = 10
): EvalCase[] {
  const take = (cases: EvalCase[]) => cases.slice(0, Math.max(0, perKind));
  return [
    ...take(amountCases(input.amounts)),
    ...take(dateCases(input.dates)),
    ...take(personCases(input.people))
  ];
}

// ---------------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------------

export interface CaseResult {
  caseId: string;
  kind: EvalCaseKind;
  /** Documents the retriever actually returned, in rank order. */
  retrievedDocumentIds: string[];
  expectedDocumentIds: string[];
  /** At least one expected document came back. The headline pass/fail. */
  hit: boolean;
  /** Fraction of the expected documents that came back, 0..1. */
  recall: number;
  /** Rank of the first expected document, 1-based; null when none came back. */
  firstHitRank: number | null;
}

export function scoreCase(
  evalCase: EvalCase,
  retrievedDocumentIds: readonly string[]
): CaseResult {
  const expected = new Set(evalCase.expectedDocumentIds);
  // Rank is over DISTINCT documents: retrieval returns chunks, and several chunks of one document
  // occupying the top slots is one document found, not three.
  const seen: string[] = [];
  for (const id of retrievedDocumentIds) if (!seen.includes(id)) seen.push(id);

  const found = seen.filter((id) => expected.has(id));
  const firstIndex = seen.findIndex((id) => expected.has(id));

  return {
    caseId: evalCase.id,
    kind: evalCase.kind,
    retrievedDocumentIds: seen,
    expectedDocumentIds: evalCase.expectedDocumentIds,
    hit: found.length > 0,
    recall:
      evalCase.expectedDocumentIds.length === 0
        ? 0
        : found.length / evalCase.expectedDocumentIds.length,
    firstHitRank: firstIndex === -1 ? null : firstIndex + 1
  };
}

export interface EvalSummary {
  total: number;
  hits: number;
  /** Share of cases where at least one expected document was retrieved. */
  hitRate: number;
  /** Mean recall across cases. Lower than hitRate whenever a fact spans several documents. */
  meanRecall: number;
  byKind: Record<string, { total: number; hits: number }>;
  /** Cases that found nothing — the ones worth reading. */
  misses: CaseResult[];
}

export function summarise(results: readonly CaseResult[]): EvalSummary {
  const byKind: Record<string, { total: number; hits: number }> = {};
  let hits = 0;
  let recallSum = 0;
  for (const result of results) {
    const bucket = byKind[result.kind] ?? { total: 0, hits: 0 };
    bucket.total += 1;
    if (result.hit) {
      bucket.hits += 1;
      hits += 1;
    }
    byKind[result.kind] = bucket;
    recallSum += result.recall;
  }
  return {
    total: results.length,
    hits,
    hitRate: results.length ? hits / results.length : 0,
    meanRecall: results.length ? recallSum / results.length : 0,
    byKind,
    misses: results.filter((r) => !r.hit)
  };
}

/**
 * What changed since the last run.
 *
 * A single score is nearly useless on its own — nobody knows whether 0.84 is good. What is actionable
 * is a case that USED to be found and now is not, which is precisely a retrieval regression, and it is
 * the shape every silent bug in this app has had.
 */
export interface EvalRegression {
  regressed: string[];
  fixed: string[];
  /** Cases present in one run and not the other; the suite changed under you. */
  added: string[];
  removed: string[];
}

export function compareRuns(
  previous: readonly CaseResult[],
  current: readonly CaseResult[]
): EvalRegression {
  const before = new Map(previous.map((r) => [r.caseId, r]));
  const after = new Map(current.map((r) => [r.caseId, r]));
  const regressed: string[] = [];
  const fixed: string[] = [];

  for (const [id, now] of after) {
    const then = before.get(id);
    if (!then) continue;
    if (then.hit && !now.hit) regressed.push(id);
    if (!then.hit && now.hit) fixed.push(id);
  }
  return {
    regressed: regressed.sort(),
    fixed: fixed.sort(),
    added: [...after.keys()].filter((id) => !before.has(id)).sort(),
    removed: [...before.keys()].filter((id) => !after.has(id)).sort()
  };
}
