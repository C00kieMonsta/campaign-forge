/**
 * Retrieval evaluation against a real workspace.
 *
 * Run:  pnpm --filter @apps/backend eval -- --workspace <uuid> --owner <email>
 *
 * NOT part of the jest suite, deliberately. It needs a live database and it spends money on
 * embeddings (one per case, a few cents for a full run). A suite that cannot run in CI without
 * credentials and a bill does not belong in the suite.
 *
 * It lives under src/ so the existing `nest build` compiles it — running TypeScript directly would
 * have meant adding ts-node just for this, and a dev-only dependency is still a dependency. The file
 * is a script, not a Nest provider: nothing imports it, so it never reaches the running server.
 *
 * WHAT IT MEASURES, AND WHAT IT DOES NOT.
 * It asks whether the retriever surfaces the documents that genuinely state a fact — a question whose
 * answer is derived from the corpus, so no human labelling is involved. It says NOTHING about whether
 * an answer is legally correct: that needs the practitioner, and eval/verified-cases.json is where her
 * judgement goes. Reporting a retrieval score as if it were an accuracy score would be exactly the
 * kind of overclaim this file exists to catch.
 *
 * Every silent defect this app has shipped lived in retrieval — the assembler dropping the live
 * question, a pinned page returning a neighbouring chunk, a one-page PDF handing over half its text.
 * None threw. This is the harness that would have caught them.
 */
// FIRST, before anything that reads process.env: ConfigService validates the whole environment in its
// constructor, so a missing DATABASE_URL fails at DI time with a Zod error rather than anywhere
// useful. main.ts does the same thing for the same reason.
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { findAmounts, findDates } from "@packages/types";
import { AppModule } from "../../app.module";
import { PgService } from "../../shared/pg.service";
import { RagService } from "../ai/rag.service";
import {
  buildGeneratedCases,
  compareRuns,
  scoreCase,
  summarise,
  type CaseResult,
  type CorpusFact,
  type EvalCase
} from "./eval-cases";

const TOP_K = 8;
/**
 * Beside the SOURCE, not the compiled output: dist is disposable and a baseline that vanished on the
 * next clean build would silently stop detecting regressions — the one thing this exists to do.
 */
const EVAL_DIR = join(process.cwd(), "eval");
const BASELINE_DIR = join(EVAL_DIR, "baselines");

interface Args {
  workspace: string;
  owner: string;
  /** Write the run as the new baseline instead of comparing against it. */
  accept: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const workspace = get("--workspace");
  const owner = get("--owner");
  if (!workspace || !owner) {
    throw new Error(
      "usage: eval --workspace <uuid> --owner <email> [--accept]"
    );
  }
  return { workspace, owner, accept: argv.includes("--accept") };
}

interface ChunkRow {
  document_id: string;
  content: string;
  key_names: unknown;
  timeline_year: number | null;
}

/**
 * Reads the corpus and derives the facts that cases are built from.
 *
 * The same deterministic scanners the app itself uses, so a case can never expect something the
 * product could not have found either — a suite that tests against a different notion of "an amount"
 * than the product uses would report failures nobody can act on.
 */
async function readCorpusFacts(
  pg: PgService,
  workspaceId: string,
  ownerEmail: string
): Promise<{
  amounts: CorpusFact[];
  dates: CorpusFact[];
  people: CorpusFact[];
}> {
  const res = await pg.query<ChunkRow>(
    `SELECT c.document_id, c.content, d.key_names,
            date_part('year', d.timeline_date)::int AS timeline_year
     FROM lex_document_chunks c
     JOIN lex_documents d ON d.id = c.document_id
     WHERE c.workspace_id = $1 AND c.owner_email = $2
       AND d.lifecycle_state = 'active'
       AND d.parse_status NOT IN ('awaiting_upload', 'failed')`,
    [workspaceId, ownerEmail]
  );

  const amounts = new Map<string, Set<string>>();
  const dates = new Map<string, Set<string>>();
  const people = new Map<string, Set<string>>();
  const candidateNames = new Set<string>();

  const add = (map: Map<string, Set<string>>, key: string, doc: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(doc);
    map.set(key, set);
  };

  for (const row of res.rows) {
    for (const hit of findAmounts(row.content))
      add(amounts, hit.raw.replace(/\s+/g, " ").trim(), row.document_id);
    for (const hit of findDates(row.content, {
      referenceYear: row.timeline_year ?? undefined
    }))
      add(dates, hit.raw.replace(/\s+/g, " ").trim(), row.document_id);
    if (Array.isArray(row.key_names))
      for (const name of row.key_names)
        if (typeof name === "string" && name.trim())
          candidateNames.add(name.trim());
  }

  /**
   * Person ground truth comes from the TEXT, not from key_names.
   *
   * key_names is metadata a model extracted per document, and the two disagree: "André Nerincx" is
   * listed by 2 documents and written in the text of 10. Scoring retrieval — which searches text —
   * against a metadata-derived answer marked four correct results as failures. key_names is still
   * where the candidate NAMES come from, since nothing else enumerates them; only the expected set is
   * recomputed from what a retriever can actually see.
   */
  const lowered = res.rows.map((row) => ({
    documentId: row.document_id,
    content: row.content.toLowerCase()
  }));
  for (const name of candidateNames) {
    const needle = name.toLowerCase();
    for (const row of lowered)
      if (row.content.includes(needle)) add(people, name, row.documentId);
  }

  const toFacts = (map: Map<string, Set<string>>): CorpusFact[] =>
    [...map.entries()].map(([literal, docs]) => ({
      literal,
      documentIds: [...docs]
    }));

  return {
    amounts: toFacts(amounts),
    dates: toFacts(dates),
    people: toFacts(people)
  };
}

/** Human-verified cases, if the practitioner has written any. Absent is fine and normal. */
function readVerifiedCases(): EvalCase[] {
  const path = join(EVAL_DIR, "verified-cases.json");
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8")) as { cases?: EvalCase[] };
  return raw.cases ?? [];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // The whole app context, not a hand-rolled query: the point is to exercise the retriever the
  // product actually uses, including its scope clauses and its rank fusion.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error"]
  });
  try {
    const pg = app.get(PgService);
    const rag = app.get(RagService);

    const facts = await readCorpusFacts(pg, args.workspace, args.owner);
    const generated = buildGeneratedCases(facts);
    const verified = readVerifiedCases();
    const cases = [...generated, ...verified];

    if (cases.length === 0) {
      console.log("No cases could be built. Is the workspace indexed?");
      return;
    }

    console.log(
      `${cases.length} cases (${generated.length} derived from the corpus, ` +
        `${verified.length} verified by hand). Retrieving top ${TOP_K}…\n`
    );

    const results: CaseResult[] = [];
    for (const evalCase of cases) {
      const retrieved = await rag.retrieve(
        args.owner,
        args.workspace,
        evalCase.question,
        TOP_K
      );
      results.push(
        scoreCase(
          evalCase,
          retrieved.map((chunk) => chunk.documentId)
        )
      );
    }

    const summary = summarise(results);
    console.log(
      `hit rate   ${(summary.hitRate * 100).toFixed(1)}%  (${summary.hits}/${summary.total})`
    );
    console.log(`mean recall ${(summary.meanRecall * 100).toFixed(1)}%`);
    for (const [kind, bucket] of Object.entries(summary.byKind))
      console.log(`  ${kind.padEnd(8)} ${bucket.hits}/${bucket.total}`);

    if (summary.misses.length > 0) {
      console.log(`\n${summary.misses.length} cases found nothing:`);
      for (const miss of summary.misses.slice(0, 15))
        console.log(`  ✗ ${miss.caseId}`);
      if (summary.misses.length > 15)
        console.log(`  … and ${summary.misses.length - 15} more`);
    }

    // The comparison is the actionable part. A bare score tells nobody whether 84% is good; a case
    // that used to be found and now is not is a regression, and that is the shape of every silent
    // bug this app has had.
    mkdirSync(BASELINE_DIR, { recursive: true });
    const baselinePath = join(BASELINE_DIR, `${args.workspace}.json`);

    if (existsSync(baselinePath)) {
      const previous = JSON.parse(
        readFileSync(baselinePath, "utf8")
      ) as CaseResult[];
      const diff = compareRuns(previous, results);
      console.log("\nagainst the last accepted run:");
      console.log(`  regressed ${diff.regressed.length}`);
      for (const id of diff.regressed) console.log(`    ↓ ${id}`);
      console.log(`  fixed     ${diff.fixed.length}`);
      for (const id of diff.fixed) console.log(`    ↑ ${id}`);
      if (diff.added.length || diff.removed.length)
        console.log(
          `  suite changed: +${diff.added.length} / -${diff.removed.length} cases`
        );
      if (diff.regressed.length > 0 && !args.accept) {
        console.log("\nRETRIEVAL REGRESSED.");
        process.exitCode = 1;
      }
    } else {
      console.log(
        "\nNo baseline yet. Re-run with --accept to record this one."
      );
    }

    if (args.accept) {
      writeFileSync(baselinePath, JSON.stringify(results, null, 2));
      console.log(`\nBaseline written: ${baselinePath}`);
    }
  } finally {
    await app.close();
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
