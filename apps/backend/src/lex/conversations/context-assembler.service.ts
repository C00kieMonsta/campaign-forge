import { Injectable, Logger } from "@nestjs/common";
import type { LexPin } from "@packages/types";
import type OpenAI from "openai";
import { PgService } from "../../shared/pg.service";
import { estimateTokens } from "../../shared/tokens";
import {
  RagService,
  sourceKey,
  withoutPinned,
  type RetrievedChunk
} from "../ai/rag.service";
import {
  AuthoritiesService,
  type RetrievedArticle
} from "../authorities/authorities.service";
import { CaseFileService } from "../documents/case-file.service";
import { outputLanguageInstruction } from "../settings/language-instruction";
import { SettingsService } from "../settings/settings.service";

// Verbatim-turn window. Deliberately LARGER than SummarizationService's CHECKPOINT_THRESHOLD:
// the checkpoint is best-effort (its failures are swallowed), so the window needs headroom to
// absorb a missed checkpoint or two without truncating live history.
const RECENT_TURN_LIMIT = 24;
const MAX_CHUNK_CHARS = 2000;
const TOP_K = 8;
/**
 * Even with pages pinned, keep a few slots for hybrid search: the answer often needs context the
 * user did not think to pin (an earlier filing that contradicts the pinned page, for instance).
 */
const MIN_SEARCH_SLOTS = 3;

/**
 * Token ceiling for the verbatim-turn portion of the prompt.
 *
 * The count is an estimate, not a tokenisation — see shared/tokens.ts for the constant and for why
 * it stays an estimate. The point here is a HARD upper bound so a thread of pasted letters cannot
 * push out the SOURCES block, not exact accounting.
 */
const MAX_TURN_TOKENS = 12000;

/**
 * How many assessment ROWS survive falling out of the verbatim window.
 *
 * A background assessment reads the whole case file and its answer is what the rest of the thread
 * refers back to — "the point the deep read made about the 2019 transfer". It is also long, so it
 * was the FIRST thing the oldest-first eviction threw away, and the model then answered follow-ups
 * about an assessment it could no longer see.
 *
 * Rows, not runs: the task runner writes each run as a PAIR (the synthetic question, then the
 * answer), both tagged 'assessment'. Four is therefore two runs — the current one and the one
 * before it, which is as far back as a thread usually argues from.
 */
const PROTECTED_ASSESSMENT_ROWS = 4;

/**
 * Ceiling on what those protected turns may spend, taken OUT of MAX_TURN_TOKENS rather than added
 * on top. An exemption would let two long assessments push the assembled prompt past a budget the
 * SOURCES block has no slack to absorb — the grounding would be crowded out by history, which is
 * the opposite trade to the one worth making.
 *
 * Held back only when an assessment ACTUALLY fell out of the window, never merely because one
 * exists — see selectTurns. Reserving against an assessment that is already in the window buys
 * nothing and evicts several turns of real history to pay for it.
 */
const PROTECTED_ASSESSMENT_TOKENS = 5000;

/**
 * Articles of law pulled in per turn, on top of the always-present digests. Smaller than the
 * document TOP_K: a statute answers in one or two articles, and the digest already says what
 * exists — this is for the verbatim wording when it matters.
 */
const AUTHORITY_TOP_K = 4;
/** Per-article cap. Belgian code articles are short; a long one is a consolidated section. */
const MAX_AUTHORITY_CHARS = 3000;

interface MessageRow {
  role: string;
  content: string;
  /** What produced the message; null for an ordinary chat turn. See the lex-message-origin migration. */
  origin: string | null;
}

/**
 * Removes inline source markers from recovered assessment text.
 *
 * An assessment cites [1] … [312] into the findings list assembled for that one run, and that list
 * is gone. The current turn's SOURCES block starts numbering from [1] again over entirely
 * different documents, so a marker copied out of the old text resolves against the new list and
 * points at the wrong pièce. Dropping the numbers costs the reader nothing — the assessment's own
 * citations are still on its original message, which the UI renders from lex_citations — and it
 * removes the only way this block could put a wrong reference into a filed document.
 *
 * Deliberately narrow: `[` digits `]` only, so bracketed text in the prose survives untouched.
 */
export function stripMarkers(text: string): string {
  return text.replace(/\[\d+\]/g, "");
}

/**
 * Chooses which verbatim turns reach the prompt, and which earlier assessments are recovered
 * beside them.
 *
 * Pure and exported so the budget arithmetic can be tested without a database: this is the code
 * that decides what a lawyer's follow-up question is answered from, and "it looked right" is not a
 * standard it should be held to.
 *
 * Two passes, not one flag check. The window pass keeps its original semantics — newest first,
 * stop at the first turn that does not fit, so the kept history stays CONTIGUOUS. A protected
 * message is not exempted inside that loop, because the loop breaks rather than skips: an
 * assessment would still be lost the moment any larger turn sat newer than it. It is recovered
 * afterwards instead, from a budget reserved before the window pass ran.
 */
export function selectTurns(turns: readonly MessageRow[]): {
  /** The contiguous recent window, in chronological order. */
  kept: MessageRow[];
  /** Assessment turns the window could not hold, in chronological order. */
  recovered: MessageRow[];
  /** Assessments that did not fit the reserve even alone — the reserve is too small. */
  oversized: number;
} {
  const windowOf = (budget: number): MessageRow[] => {
    const out: MessageRow[] = [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const cost = estimateTokens(turns[i].content);
      if (out.length > 0 && cost > budget) break;
      budget -= cost;
      out.push(turns[i]);
    }
    return out.reverse();
  };

  // The reserve is paid only if a full-budget window actually loses an assessment. Testing merely
  // that one EXISTS is the common case and the wrong one: right after a background run finishes,
  // its answer is the newest message and comfortably inside the window, so the 5000 tokens would
  // be withheld for a recovery pass with nothing to recover — several turns of real history
  // evicted to protect something that was never at risk.
  //
  // Re-running on the smaller budget cannot change the answer: shrinking a budget only removes
  // turns from the window, so an assessment already outside it stays outside.
  let kept = windowOf(MAX_TURN_TOKENS);
  let inWindow = new Set(kept);
  const needsReserve = turns.some(
    (m) => m.origin === "assessment" && !inWindow.has(m)
  );
  if (needsReserve) {
    kept = windowOf(MAX_TURN_TOKENS - PROTECTED_ASSESSMENT_TOKENS);
    inWindow = new Set(kept);
  }

  const recovered: MessageRow[] = [];
  let protectedBudget = PROTECTED_ASSESSMENT_TOKENS;
  let oversized = 0;
  for (let i = turns.length - 1; i >= 0 && needsReserve; i--) {
    const m = turns[i];
    if (m.origin !== "assessment" || inWindow.has(m)) continue;
    if (recovered.length >= PROTECTED_ASSESSMENT_ROWS) break;
    const cost = estimateTokens(m.content);
    // Skipped, never truncated. A half-assessment reads exactly like a whole one, and this app
    // does not hand a practitioner a legal conclusion with its reasoning silently cut off.
    if (cost > protectedBudget) {
      oversized += 1;
      continue;
    }
    protectedBudget -= cost;
    recovered.push(m);
  }
  recovered.reverse();

  // A question with no answer under it is not an assessment. Walking newest-first visits the
  // answer before the question it belongs to, so an answer too large for the reserve is skipped
  // and its short question is then recovered alone — under a header promising findings that are
  // not there. Drop the set; `oversized` is already carrying the diagnostic.
  if (!recovered.some((m) => m.role === "assistant")) recovered.length = 0;

  return { kept, recovered, oversized };
}

interface SummaryRow {
  through_message_seq: string;
  summary: string;
}

export interface AssembledContext {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  sources: RetrievedChunk[];
  /**
   * Which prompt blocks were included, in prompt order. Purely for the usage log: prompt-cache hit
   * rate is only comparable between turns that had the same blocks, since a turn where no
   * authority was enabled has a structurally different prefix from one where four articles were
   * pulled in.
   */
  blocks: string[];
}

/**
 * Builds the bounded prompt for a chat turn: system instructions + durable conversation
 * summary (older turns, compressed) + recent verbatim turns (after the summary watermark) +
 * a first-class SOURCES block from retrieval. Sources are never evicted — grounding has a
 * reserved floor so the model always has documents to cite from.
 */
@Injectable()
export class ContextAssembler {
  private readonly logger = new Logger(ContextAssembler.name);

  constructor(
    private pg: PgService,
    private rag: RagService,
    private settings: SettingsService,
    private authorities: AuthoritiesService,
    private caseFile: CaseFileService
  ) {}

  async assemble(
    ownerEmail: string,
    workspaceId: string,
    conversationId: string,
    query: string,
    pins: LexPin[] = []
  ): Promise<AssembledContext> {
    // Pinned pages first and verbatim — they are what the user pointed at. Hybrid search then
    // fills the remaining slots, skipping anything the pins already cover so a source is never
    // listed twice under two different [n] markers.
    const pinned = await this.rag.retrievePinned(ownerEmail, workspaceId, pins);
    const pinnedKeys = new Set(pinned.map(sourceKey));
    const searched = withoutPinned(
      await this.rag.retrieve(ownerEmail, workspaceId, query, TOP_K),
      pinned
    );

    const searchSlots = Math.max(
      MIN_SEARCH_SLOTS,
      TOP_K - Math.min(pinned.length, TOP_K - MIN_SEARCH_SLOTS)
    );
    const sources = [...pinned, ...searched.slice(0, searchSlots)];

    // What the turn was actually grounded in. Logged because "the answer ignored my pinned page"
    // is otherwise indistinguishable from "the pin never arrived" or "those pages have no indexed
    // text" — three different faults with three different fixes.
    if (pins.length > 0) {
      this.logger.log(
        JSON.stringify({
          action: "lexPinnedSources",
          conversationId,
          pinsRequested: pins.length,
          pagesRequested: pins.flatMap((p) => p.pages),
          pinnedChunks: pinned.length,
          searchChunks: sources.length - pinned.length
        })
      );
    }

    const summaryRes = await this.pg.query<SummaryRow>(
      `SELECT through_message_seq, summary FROM lex_conversation_summaries
       WHERE conversation_id = $1 ORDER BY through_message_seq DESC LIMIT 1`,
      [conversationId]
    );
    const summary = summaryRes.rows[0];
    const watermark = summary ? Number(summary.through_message_seq) : 0;

    // Take the NEWEST turns, then restore chronological order for the prompt. Selecting the
    // oldest N instead would drop the newest messages — including the question being asked
    // right now — whenever more than N messages sit past the watermark (which happens as soon
    // as one best-effort checkpoint fails).
    const msgRes = await this.pg.query<MessageRow>(
      `SELECT role, content, origin FROM (
         SELECT seq, role, content, origin FROM lex_messages
         WHERE conversation_id = $1 AND status = 'complete' AND seq > $2
         ORDER BY seq DESC
         LIMIT $3
       ) recent
       ORDER BY seq ASC`,
      [conversationId, watermark, RECENT_TURN_LIMIT]
    );

    const sourcesBlock = sources.length
      ? sources
          .map(
            (s, i) =>
              `[${i + 1}] (${s.filename}${s.pageFrom ? `, p.${s.pageFrom}` : ""})` +
              `${pinnedKeys.has(sourceKey(s)) ? " [PINNED BY THE USER]" : ""}:\n` +
              // Pinned text is never truncated by the per-chunk cap — retrievePinned already
              // applied its own total budget, and clipping a page the user pointed at is worse
              // than a slightly longer prompt.
              (pinnedKeys.has(sourceKey(s))
                ? s.content
                : s.content.slice(0, MAX_CHUNK_CHARS))
          )
          .join("\n\n")
      : "(no relevant documents found in this workspace)";

    const pinnedNote =
      pinned.length > 0
        ? " The user has PINNED specific pages: those sources are the subject of the question — " +
          "read them closely and answer from them first. The unpinned sources are supporting " +
          "context only."
        : "";

    const language = await this.settings.languageOf(ownerEmail);

    // ── Authorities ──────────────────────────────────────────────────────────────────────
    // The law the user uploaded, present on EVERY turn in two forms:
    //  1. the digest — a compact article-numbered map of each enabled authority, so the model
    //     knows what law exists and which article to reach for;
    //  2. retrieved article text, when the question touches something in it.
    // Both are best-effort: a missing digest degrades the answer, but must never fail the turn.
    const digests = await this.authorities.enabledDigests(ownerEmail);

    // The case file: WHAT documents exist, as against SOURCES, which is the TEXT of the few
    // retrieved for this question. Best-effort like the digests, and for the same reason — an
    // inventory that cannot be read costs the turn its inventory, not the turn.
    const manifest = await this.caseFile.manifest(ownerEmail, workspaceId);
    const articles = await this.authorities
      .retrieve(ownerEmail, query, AUTHORITY_TOP_K)
      .catch(() => [] as RetrievedArticle[]);

    const system =
      "You are Lex, a meticulous legal assistant for Belgian-law court files. " +
      // Without this the model treats "can you read this page?" as a question about its own
      // capabilities and refuses ("I cannot access PDF files"), even while the page's text sits
      // in front of it. The SOURCES are already-extracted text, not attachments to open.
      "The SOURCES below are the EXTRACTED TEXT of the user's own documents — they are already " +
      "in front of you. You are therefore ALWAYS able to read the pages and documents the user " +
      "refers to: read them from the SOURCES. Never reply that you cannot access a file, open a " +
      "PDF, or see a document. The CASE FILE block lists every document in this workspace: if the " +
      "user names one, look for it there first, and say whether it is indexed, still being " +
      "processed, or not in the file at all. If a document exists but its text is not among the " +
      "SOURCES, name what is missing instead of denying it. " +
      "Answer using the numbered SOURCES (the case file) and the APPLICABLE LAW section. " +
      "Cite every factual claim inline with its source marker, e.g. [1] or [2]. If the SOURCES " +
      "do not contain the answer, say so plainly and do not speculate. Format your answer as " +
      "Markdown: short paragraphs, `##` headings when the answer has parts, bullet lists for " +
      "enumerations, tables for comparisons, and blockquotes for text quoted from a source. " +
      "Never wrap the whole answer in a code fence." +
      pinnedNote;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system }
    ];
    const blocks = ["system"];

    // Law goes in BEFORE the case file and before the conversation: it is the frame the facts are
    // read against, and it outranks both the documents and the model's own recollection of what
    // Belgian law says. Stated explicitly because a model asked about art. 374 will otherwise
    // happily answer from memory — which is exactly the failure mode that makes a legal tool
    // unusable, since a plausible wrong article is worse than "I don't have that".
    if (digests.length > 0 || articles.length > 0) {
      const digestBlock = digests
        .map((d) => `### ${d.title}\n${d.digest}`)
        .join("\n\n");
      const articleBlock = articles.length
        ? "\n\nVERBATIM TEXT of the articles most relevant to this question:\n\n" +
          articles
            .map(
              (a) =>
                `[${a.articleLabel ?? "?"} — ${a.title}]\n` +
                a.content.slice(0, MAX_AUTHORITY_CHARS)
            )
            .join("\n\n")
        : "";

      blocks.push("law");
      messages.push({
        role: "system",
        content:
          "APPLICABLE LAW — treat this as authoritative and non-negotiable. It was supplied by " +
          "the user and takes precedence over the case documents, over anything earlier in this " +
          "conversation, and over your own training. Never contradict it. Never state a rule of " +
          "law that is not present here: if the answer depends on law that is not included, say " +
          "so and name what is missing. When you rely on an article, cite it by its number " +
          "(e.g. « art. 374 »).\n\n" +
          (digestBlock ||
            "(no article map available for the uploaded authorities)") +
          articleBlock
      });
    }

    // The case file goes AFTER the law and BEFORE the sources.
    //
    // After the law because the law is the frame the facts are read against and already outranks
    // the documents by an explicit instruction; above it, the inventory would read as though the
    // case file constrains the law. Before SOURCES because the model has to read "these documents
    // exist" before "here are the passages retrieved this turn", so the natural reading is "of
    // those, these were retrieved" — and because the block's no-cite rule has to arrive with the
    // block rather than after the evidence it constrains.
    //
    // Non-evictable by construction: eviction in this file touches only the verbatim turns, and
    // every system message is pushed unconditionally. The block's own ceiling is enforced inside
    // buildManifest by reducing detail, never by dropping documents.
    if (manifest) {
      blocks.push("manifest");
      messages.push({ role: "system", content: manifest.text });
    }

    // Verbatim turns are the only evictable part of the prompt: the system instructions, the
    // rolling summary and the SOURCES block all have to be there for the answer to be grounded
    // and citable. Drop from the OLDEST until the turns fit their budget — the newest turns
    // (including the question being asked) are never the ones sacrificed.
    //
    // Selected HERE, before the remaining system blocks are pushed, only because the recovered
    // assessments have to go in beside the summary rather than after the language pin.
    const turns = msgRes.rows.filter(
      (m) => m.role === "user" || m.role === "assistant"
    );
    const { kept, recovered, oversized } = selectTurns(turns);

    if (summary) {
      blocks.push("summary");
      messages.push({
        role: "system",
        content: `Summary of earlier conversation:\n${summary.summary}`
      });
    }

    // Beside the rolling summary, and BEFORE the language pin: both are compressed earlier
    // conversation, and the pin has to stay the last system message the model reads.
    //
    // The markers are stripped on the way in. A recovered assessment is full of [1], [2] … that
    // number a findings list which no longer exists, and the current turn's SOURCES block numbers
    // a different list from 1. Left in, the model copies a stale marker into its reply and the
    // citation resolver anchors it to whichever document happens to hold that position today —
    // a reference that opens the wrong pièce is worse than one that opens nothing.
    if (recovered.length > 0) {
      blocks.push("assessments");
      messages.push({
        role: "system",
        content:
          "EARLIER ASSESSMENTS IN THIS THREAD. These are background runs that read the case file " +
          "in full, kept here because later turns refer back to what they concluded. They are " +
          "older than the conversation shown below, not part of it. Their own source markers have " +
          "been removed because the list they numbered is gone: do not cite from this block, cite " +
          "only from SOURCES. Treat their findings as already established unless a later turn " +
          "contradicts them.\n\n" +
          recovered
            .map(
              (m) =>
                `[${m.role === "user" ? "ASKED" : "ANSWERED"}]\n${stripMarkers(m.content)}`
            )
            .join("\n\n")
      });
    }

    blocks.push("sources");
    messages.push({ role: "system", content: `SOURCES:\n${sourcesBlock}` });
    // Last system message, so the language pin is the most recent instruction the model reads.
    // Sources and prior turns are frequently in another language and would otherwise drag the
    // reply along with them.
    blocks.push("language");
    messages.push({
      role: "system",
      content: outputLanguageInstruction(language)
    });

    for (const m of kept) {
      messages.push({
        role: m.role as "user" | "assistant",
        content: m.content
      });
    }

    if (kept.length < turns.length) {
      this.logger.log(
        JSON.stringify({
          action: "lexContextTrimmed",
          conversationId,
          droppedTurns: turns.length - kept.length,
          keptTurns: kept.length,
          recoveredAssessments: recovered.length,
          // Non-zero means PROTECTED_ASSESSMENT_TOKENS is too small for this workspace's
          // assessments and one was dropped entirely — the failure this reserve exists to prevent.
          oversizedAssessments: oversized
        })
      );
    }

    if (kept.length > 0) blocks.push("turns");

    // Logged every turn because "the chat said it did not have my file" is otherwise
    // indistinguishable from three different faults: the document was archived, ingestion never
    // finished, or the workspace outgrew the block. tier === 'counts' is the one to alert on — it
    // means no document is listed individually and the model is working from a total.
    this.logger.log(
      JSON.stringify({
        action: "lexCaseFileManifest",
        conversationId,
        total: manifest?.total ?? 0,
        listed: manifest?.listed ?? 0,
        archived: manifest?.archived ?? 0,
        tier: manifest?.tier ?? "none",
        chars: manifest?.text.length ?? 0
      })
    );

    return { messages, sources, blocks };
  }
}
