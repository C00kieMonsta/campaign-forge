import { Injectable, Logger } from "@nestjs/common";
import { findAmounts, findDates } from "@packages/types";
import { OpenAiService } from "../../shared/openai.service";
import { PgService } from "../../shared/pg.service";
import { estimateTokens } from "../../shared/tokens";
import { outputLanguageInstruction } from "../settings/language-instruction";
import { SettingsService } from "../settings/settings.service";

// Once this many complete messages accumulate past the last summary watermark, fold them
// into a new rolling summary so the assembled context stays bounded over a years-long thread.
// Must stay BELOW ContextAssembler's RECENT_TURN_LIMIT so a checkpoint fires with room to
// spare; equal values leave zero headroom and a single failed checkpoint starts truncating.
const CHECKPOINT_THRESHOLD = 12;

/**
 * How many messages one checkpoint folds, oldest first.
 *
 * Batching is what stops a failed checkpoint compounding. The fold used to take EVERY message past
 * the watermark: when one failed, the watermark stayed put, the next turn fed a longer transcript to
 * the same fixed output budget, and each retry was strictly likelier to fail than the last. Once
 * more than ContextAssembler's RECENT_TURN_LIMIT messages sat behind the stale watermark, the oldest
 * ones stopped reaching the model at all — a legal thread silently losing its own history.
 *
 * With a batch, a backlog DRAINS: every successful checkpoint advances the watermark even if an
 * earlier one failed, and the work per turn is bounded.
 */
const MAX_MESSAGES_PER_CHECKPOINT = 24;

/**
 * Output budget for the fold, in tokens of prose.
 *
 * Scaled by the prior summary, not fixed. The fold must RESTATE everything already summarised plus
 * the new turns, so a constant ceiling is a promise that breaks precisely when a case thread gets
 * long enough to need summarising.
 *
 * Measured with the shared estimateTokens rather than a local `/ 4`. The two disagreed, and the
 * local one disagreed in the unsafe direction: at 4 chars per token it under-counted what restating
 * the prior summary costs by about 15%, so a fold near the ceiling was handed fewer output tokens
 * than the text it had to reproduce.
 *
 * The ceiling is 12000, not 4000. At 4000 a summary that reached roughly 13600 characters could no
 * longer be restated at all, so every later fold compressed lossily and the early case history
 * eroded on exactly the years-long threads this exists to serve. 12000 tokens of prose is a long
 * summary and still a fraction of a chat turn's prompt, which is the right trade for a legal thread.
 */
const SUMMARY_MAX_TOKENS = 12000;

function summaryBudget(prior: string): number {
  return Math.min(
    SUMMARY_MAX_TOKENS,
    Math.max(1200, estimateTokens(prior) + 800)
  );
}

/**
 * ISO dates, which findDates deliberately does not match.
 *
 * packages/types' NUMERIC pattern reads dd/mm/yyyy (day first, one or two digits) and its lookbehind
 * rejects the "98-05-27" sitting inside "1998-05-27". That is correct for a Belgian filing and wrong
 * for lostFacts, which compares a summary the model may legitimately have rewritten from
 * "27 mai 1998" into "1998-05-27". Scanned separately here rather than by widening the shared
 * pattern, because the shared one also feeds the chronology and a change there moves real dates.
 */
const ISO_DATE = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g;

/**
 * Facts the prior summary stated that the new one no longer does.
 *
 * Dates by ISO value and amounts by value plus currency, never by their raw spelling: a fold is
 * allowed to rewrite "27 mai 1998" as "27/05/1998", and is not allowed to lose the day. Nothing
 * here needs a model, which is the point — a summary that quietly drops the date a prescription
 * runs from is a loss this app cannot otherwise detect.
 *
 * Pure and exported so the arithmetic can be tested without a database or an API key.
 */
export function lostFacts(prior: string, next: string): string[] {
  const dates = (text: string): Set<string> => {
    const set = new Set(findDates(text).map((d) => d.iso));
    for (const m of text.matchAll(ISO_DATE)) set.add(m[0]);
    return set;
  };
  const amounts = (text: string): Set<string> =>
    new Set(findAmounts(text).map((a) => `${a.value} ${a.currency}`));

  const priorDates = dates(prior);
  const nextDates = dates(next);
  const priorAmounts = amounts(prior);
  const nextAmounts = amounts(next);
  return [
    ...[...priorDates].filter((d) => !nextDates.has(d)),
    ...[...priorAmounts].filter((a) => !nextAmounts.has(a))
  ];
}

interface MsgRow {
  seq: string;
  role: string;
  content: string;
}

/**
 * Rolling conversation summarization. Each checkpoint summarizes messages since the last
 * watermark (folding in the prior summary for continuity), so context assembly can send
 * `latest summary + messages after its watermark`.
 *
 * NOTE: semantic-fidelity verification of summaries (an NLI check that a summary never
 * distorts a fact it still references) is a court-safety control that lands with the
 * artifact verification pass in Phase 4.
 */
@Injectable()
export class SummarizationService {
  private readonly logger = new Logger(SummarizationService.name);

  constructor(
    private pg: PgService,
    private openai: OpenAiService,
    private settings: SettingsService
  ) {}

  async maybeCheckpoint(
    conversationId: string,
    ownerEmail: string
  ): Promise<void> {
    const wmRes = await this.pg.query<{ wm: string }>(
      `SELECT COALESCE(MAX(through_message_seq), 0) AS wm
       FROM lex_conversation_summaries WHERE conversation_id = $1`,
      [conversationId]
    );
    const watermark = Number(wmRes.rows[0].wm);

    const msgs = await this.pg.query<MsgRow>(
      `SELECT seq, role, content FROM lex_messages
       WHERE conversation_id = $1 AND status = 'complete' AND seq > $2
       ORDER BY seq ASC`,
      [conversationId, watermark]
    );
    if (msgs.rows.length < CHECKPOINT_THRESHOLD) return;

    // Oldest first, bounded — see MAX_MESSAGES_PER_CHECKPOINT. A backlog is drained over several
    // turns rather than attempted whole and failing whole.
    const batch = msgs.rows.slice(0, MAX_MESSAGES_PER_CHECKPOINT);
    const maxSeq = Number(batch[batch.length - 1].seq);
    const transcript = batch.map((m) => `${m.role}: ${m.content}`).join("\n");

    const priorRes = await this.pg.query<{ summary: string }>(
      `SELECT summary FROM lex_conversation_summaries
       WHERE conversation_id = $1 ORDER BY through_message_seq DESC LIMIT 1`,
      [conversationId]
    );
    const prior = priorRes.rows[0]?.summary;

    // The summary is re-injected as a system message on EVERY subsequent turn, so its language
    // steers the reply's language. Pinning it here is what stops a thread drifting into English.
    const language = await this.settings.languageOf(ownerEmail);

    const summary = await this.openai.complete({
      system:
        "You maintain a running, strictly factual summary of a legal-case conversation. " +
        "Preserve every fact, decision, party name, date, amount, and document reference. Never " +
        "drop details or speculate.\n" +
        // A fixed skeleton, because prose folded into prose loses uniformly and the first casualty
        // is a date from turn three. With headings, a fold that has to shorten has somewhere
        // designated to shorten.
        //
        // The headings are English while the CONTENT is the user's language, deliberately: they are
        // structural anchors that the append-only rule is stated against, so every fold has to
        // recognise the previous fold's structure. Translated headings would drift between folds
        // and the rule would have nothing to hold onto.
        "Write it under EXACTLY these headings, in this order, omitting none. Keep the headings in " +
        "English; write everything under them in the language named below.\n" +
        "## PARTIES\n## DATES AND ACTS\n## AMOUNTS\n## POSITIONS AND DECISIONS\n" +
        "## OPEN QUESTIONS\n## OTHER\n" +
        "The first four headings are APPEND-ONLY: never remove or reword a party, a date, an act, " +
        "an amount, a decision or a position that the prior summary already lists. When the new " +
        "turns force you to shorten, shorten ## OTHER and nothing else. Preserve every document " +
        "reference verbatim.\n" +
        outputLanguageInstruction(language),
      user:
        `${prior ? `Prior summary:\n${prior}\n\n` : ""}` +
        `New conversation turns to fold in:\n${transcript}\n\n` +
        `Produce an updated, comprehensive running summary.`,
      maxTokens: summaryBudget(prior ?? "")
    });

    if (!summary.trim()) return;

    // MEASURED, NOT GATED. Refusing to advance the watermark on a loss was the obvious next step
    // and it is the wrong one for now: the loss this detects is caused by the output ceiling, so
    // retrying the same batch against the same ceiling fails the same way and only triples the
    // call count. Raising SUMMARY_MAX_TOKENS is the fix that was shipped with it. This log is how
    // we find out whether the raise was enough before adding a gate that costs money.
    const lost = lostFacts(prior ?? "", summary);
    if (lost.length > 0) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexConvSummaryLostFacts",
          conversationId,
          priorChars: prior?.length ?? 0,
          lostCount: lost.length,
          lost: lost.slice(0, 20)
        })
      );
    }

    await this.pg.query(
      `INSERT INTO lex_conversation_summaries (conversation_id, through_message_seq, level, summary)
       VALUES ($1, $2, 1, $3)`,
      [conversationId, maxSeq, summary]
    );
    this.logger.log(
      JSON.stringify({
        action: "lexConvSummary",
        conversationId,
        throughSeq: maxSeq
      })
    );
  }
}
