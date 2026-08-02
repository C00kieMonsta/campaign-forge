import { Injectable, Logger } from "@nestjs/common";
import { OpenAiService } from "../../shared/openai.service";
import { PgService } from "../../shared/pg.service";
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
 * long enough to need summarising. Roughly four characters to the token, plus room for the batch.
 */
function summaryBudget(priorChars: number): number {
  return Math.min(4000, Math.max(1200, Math.ceil(priorChars / 4) + 800));
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
        "Preserve every fact, decision, party name, date, amount, and document reference. Never drop details or speculate. " +
        outputLanguageInstruction(language),
      user:
        `${prior ? `Prior summary:\n${prior}\n\n` : ""}` +
        `New conversation turns to fold in:\n${transcript}\n\n` +
        `Produce an updated, comprehensive running summary.`,
      maxTokens: summaryBudget(prior?.length ?? 0)
    });

    if (!summary.trim()) return;

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
