// Lex (legal-RAG) EXPOSED API CONTRACT — what the backend chooses to surface to the client.
// This is NOT a 1:1 mirror of the PostgreSQL schema: the persistence rows live PRIVATELY as
// snake_case `Row` interfaces inside each backend service (e.g. WorkspaceRow, DocumentRow),
// mapped to these wire types and never exported from @packages/types.
//
// RULE: internal-only columns (e.g. the `embedding halfvec(3072)` on document_chunks, or any
// future internal scoring/soft-delete flag) go on the private Row + SQL ONLY — never add them
// here. (LexDocumentChunk omitting `embedding` is the precedent to follow.)
//
// Timestamps are ISO strings over the wire.

import type { ReasoningDepth } from "../models";

export type LexParseStatus =
  /** Row exists, but the browser has not finished PUTting the bytes to S3 yet. */
  | "awaiting_upload"
  | "uploaded"
  | "parsing"
  | "transcribing"
  | "chunking"
  | "embedding"
  | "summarizing"
  | "ready"
  | "failed"
  | "needs_ocr"
  /** Same content as another document in the workspace; excluded from retrieval. */
  | "duplicate";

export type LexLifecycleState = "active" | "superseded" | "archived";
export type LexMessageRole = "user" | "assistant" | "system";
export type LexMessageStatus = "pending" | "complete" | "failed";
export type LexArtifactType = "memo" | "chronology" | "submission";
export type LexArtifactStatus = "draft" | "verified" | "final" | "filed";
export type LexVerificationStatus = "unverified" | "verified" | "failed";

/**
 * The languages Lex speaks. One pinned value drives the admin UI AND, enforced server-side, the
 * assistant's replies, conversation summaries, generated drafts and document summaries — so the
 * whole product speaks one language instead of drifting between French and English.
 */
export type LexLanguage = "fr" | "nl";

export interface LexUser {
  email: string;
  displayName?: string | null;
  language: LexLanguage;
  createdAt: string;
}

/** The user's settings, a singleton per account (keyed by email). */
export interface LexUserSettings {
  email: string;
  language: LexLanguage;
}

export interface LexWorkspace {
  id: string;
  ownerEmail: string;
  name: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LexDocument {
  id: string;
  workspaceId: string;
  ownerEmail: string;
  filename: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  s3Key: string;
  s3VersionId?: string | null;
  sha256: string;
  parseStatus: LexParseStatus;
  lifecycleState: LexLifecycleState;
  /** Legally-relevant date (drives the timeline), distinct from createdAt. */
  timelineDate?: string | null;
  pageCount?: number | null;
  /** Summary, in the document's own language. */
  summary?: string | null;
  /** BCP-47-ish language code of the document (e.g. "fr", "nl", "en"). */
  language?: string | null;
  /** Key names (people/organisations/parties) mentioned — for search. */
  keyNames: string[];
  /** Topical tags — for search/filtering. */
  tags: string[];
  /**
   * Audio length, for voice notes (a document whose contentType is audio/*). The transcript
   * itself is a sub-resource (see LexTranscript) so listing documents stays cheap.
   */
  durationSeconds?: number | null;
  /**
   * Set when this document duplicates another in the same workspace (byte-identical, or the
   * same text re-scanned/re-exported). The duplicate is marked lifecycle_state 'superseded' so
   * retrieval skips it — otherwise the same fact would be citable from two copies.
   */
  duplicateOf?: string | null;
  /** Original folder path, when the document arrived as part of a dropped folder. */
  sourcePath?: string | null;
  error?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a bulk archive / restore ACTUALLY moved: the ids whose lifecycle_state changed, never the
 * ids that were asked for. An id that was already in the target state, belongs to someone else, or
 * is 'superseded' is simply absent — so this list is precisely what an Undo has to replay, and a
 * caller that needs the skipped ids diffs its request against it.
 */
export interface LexLifecycleChange {
  documentIds: string[];
}

/**
 * One reserved upload: the document row that exists but has no bytes yet, plus the presigned
 * PUT the browser must use. `contentType` is echoed back because S3 validates that the PUT sends
 * exactly the type the URL was signed for.
 */
export interface LexUploadSlot {
  document: LexDocument;
  uploadUrl: string;
  contentType: string;
}

/**
 * A voice note's transcript — a sub-resource of LexDocument, fetched on demand (it can run to
 * tens of thousands of characters, so it stays off the document list). Hand-editable: saving a
 * corrected transcript re-indexes the document without re-transcribing.
 */
export interface LexTranscript {
  documentId: string;
  transcript: string | null;
  durationSeconds?: number | null;
  parseStatus: LexParseStatus;
  updatedAt: string;
}

export interface LexDocumentChunk {
  id: string;
  documentId: string;
  workspaceId: string;
  ownerEmail: string;
  chunkIndex: number;
  pageFrom?: number | null;
  pageTo?: number | null;
  /** Char offsets into the document text — the anchor a citation resolves to. */
  charStart?: number | null;
  charEnd?: number | null;
  content: string;
  tokenCount?: number | null;
}

// ── Per-page index ────────────────────────────────────────────────────────────────────
// Documents ingested before the per-page index existed have no page rows, so pinning a page falls
// back to the coarse chunk path and a quote can be filed under the wrong page number. The backfill
// (ingestion mode 'pages') rebuilds the exact page grain from the stored S3 object, re-using the
// existing chunks and embeddings — no re-embedding and no paid call. These types are the API over
// that migration; the page rows themselves are never surfaced (retrieval reads them, the client
// addresses pages by number).

/**
 * A document the free backfill cannot index, with the worker's reason. The blocking case is a
 * scan whose text only OCR can recover: OCR costs money AND is non-deterministic, so its output
 * could not be verified against the already-indexed chunks anyway — the fix is a full re-ingest,
 * which is a decision for the user, not something a maintenance job should spend on its own.
 */
export interface LexPageIndexBlockedDocument {
  documentId: string;
  filename: string;
  error: string;
}

/**
 * Progress of the per-page index across ALL of the user's case files, counted over the documents
 * the backfill actually targets (parse_status 'ready' AND lifecycle_state 'active'). `indexed`,
 * `pending` and `blocked` are disjoint and sum to `total`.
 *
 * Account-wide, not per workspace, because the rebuild it reports on is account-wide: a
 * workspace-scoped readout beside that button would show one case file frozen while another drains.
 */
export interface LexPageIndexStatus {
  total: number;
  /** Has an exact page index; pinning a page returns that page. */
  indexed: number;
  /** No index yet — still served by the coarse chunk fallback. */
  pending: number;
  /**
   * How many of the un-indexed documents (`pending`, plus any `blocked` one being retried) have a
   * 'pages' job queued or running. Not a fourth bucket: it is what distinguishes "the worker is
   * chewing through the queue" from "the worker is down and these numbers will never move".
   */
  queued: number;
  /** No index, with a recorded reason. Every one of these needs a decision from the user. */
  blocked: number;
  /** Bounded sample of the blocked documents, so the payload stays pollable. */
  blockedDocuments: LexPageIndexBlockedDocument[];
  /** True when `blocked` exceeds the sample returned above. */
  blockedTruncated: boolean;
}

/** How many documents the backfill request actually enqueued (already-queued ones are skipped). */
export interface LexPageIndexBackfill {
  queued: number;
}

export interface LexConversation {
  id: string;
  workspaceId: string;
  ownerEmail: string;
  title?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LexMessage {
  id: string;
  conversationId: string;
  ownerEmail: string;
  seq: number;
  role: LexMessageRole;
  content: string;
  status: LexMessageStatus;
  tokenCount?: number | null;
  createdAt: string;
}

export interface LexArtifact {
  id: string;
  workspaceId: string;
  conversationId?: string | null;
  ownerEmail: string;
  type: LexArtifactType;
  title: string;
  status: LexArtifactStatus;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * WHAT a sentence in a drafted document is, which decides whether citing it is even meaningful.
 *
 * A court document is not a list of facts. It states facts, argues from them, and then asks the
 * court for something — and only the first of those can be established by a quote from the case
 * file. Without this distinction every sentence was graded on the same evidentiary scale, so
 * "Il est proposé de demander au Tribunal de reconnaître l'accord" came back `unsupported` and
 * dragged an otherwise sound draft to `failed`, with nothing the drafter could do about it: no
 * pièce in any case file says what her client will request.
 *
 * Only `assertion` is verified. The other three are the document's own voice:
 *   argument  what a party contends or infers, stated as advocacy rather than as fact.
 *   relief    what the court is asked to order — a prayer for relief or a procedural request.
 *   heading   a title, a transition, a section label. Structure, asserting nothing.
 *
 * NOT a loophole: the exemption applies only to a claim that cites NOTHING (see
 * isExemptFromVerification). A claim carrying a quote is verified whatever it calls itself, so
 * labelling a sentence `argument` cannot launder a citation the quote does not support.
 */
export type LexClaimKind = "assertion" | "argument" | "relief" | "heading";

/**
 * `not_checked` is not a fourth way to fail. It means verification did not apply to this sentence
 * — it asserts no fact and cites nothing — and it is counted separately from the assertions so a
 * report can never present an unverifiable request as an unsupported fact.
 */
export type LexClaimStatus =
  | "supported"
  | "unsupported"
  | "contradicted"
  | "not_checked";

/** A single factual claim in a generated artifact, anchored to a source span (or flagged). */
export interface LexArtifactClaim {
  claimId: string;
  text: string;
  /**
   * Absent on versions generated before kinds existed, where every sentence was drafted and
   * judged as a factual assertion. Readers must therefore default a missing kind to `assertion`
   * rather than to "exempt", or a re-verification would silently stop checking old drafts.
   */
  kind?: LexClaimKind;
  status: LexClaimStatus;
  citation?: {
    chunkId: string;
    documentId: string;
    filename: string;
    pageFrom: number | null;
    pageTo: number | null;
    quote: string;
  } | null;
  /**
   * Why the claim ended up with this status, in the judge's own words.
   *
   * Persisted because the UI used to render every non-supported claim as one red badge, and the
   * three ways a claim fails have nothing to do with each other: nothing was cited, the quote was
   * not in the source, or the quote does not carry the fact. Without the reason the user cannot
   * tell "the model invented a source" from "your sentence claims one thing more than its
   * evidence" — and only the second is something she can fix by editing the sentence.
   */
  reason?: string | null;
}

/** The stored artifact body (a structured, citation-anchored document). */
export interface LexArtifactBody {
  type: "lex-artifact";
  claims: LexArtifactClaim[];
}

/** One pièce the drafter actually read, and how much of it reached the prompt. */
export interface LexArtifactSource {
  documentId: string;
  filename: string;
  /** Spans of this pièce in the evidence pack. */
  passages: number;
}

export interface LexArtifactVerificationReport {
  /**
   * The VERIFIABLE claims — the factual assertions. Not the sentence count.
   *
   * These three counts describe the document's evidence, so a sentence that asserts no fact has
   * no place in them: including the prayer for relief in `total` and in `unsupported` is what
   * reported a sound draft as "11/16" and blocked it from filing.
   */
  total: number;
  supported: number;
  unsupported: number;
  /** Sentences verification did not apply to (argument, relief, heading). See LexClaimKind. */
  notChecked?: number;
  /**
   * What the draft was written FROM. Absent on versions generated before this was recorded, and on
   * manual edits.
   *
   * Persisted rather than derived from the citations, because the two answer different questions:
   * the citations say which passages survived verification, `sources` says which the drafter was
   * shown. A pièce the user selected and that produced no cited claim is exactly the thing worth
   * seeing — it is either irrelevant or a gap in the draft, and the citation list cannot tell her.
   */
  sources?: LexArtifactSource[];
  /** `search` sampled the file by similarity; `full` read the selection up to the pack cap. */
  sourceMode?: "search" | "full";
  /** True when the pack hit its cap, i.e. the selection was larger than what was read. */
  truncated?: boolean;
}

export interface LexArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  bodyJson: LexArtifactBody;
  verificationStatus: LexVerificationStatus;
  verificationReport?: LexArtifactVerificationReport | null;
  signedOffAt?: string | null;
  signedOffBy?: string | null;
  createdAt: string;
}

// ── Authorities ───────────────────────────────────────────────────────────────────────
// An authority is law the user has uploaded (a code, a statute, a leading judgment) and which
// Lex must treat as non-negotiable truth. Distinct from LexArtifact, which is GENERATED output.
//
// Authorities are OWNER-scoped, not workspace-scoped: Belgian family law applies to every case
// this user has. `enabled` decides whether an authority is injected into chat turns at all.

export type LexAuthorityStatus =
  | "awaiting_upload"
  | "uploaded"
  | "parsing"
  | "chunking"
  | "embedding"
  | "digesting"
  | "ready"
  | "failed";

export interface LexAuthority {
  id: string;
  ownerEmail: string;
  /** Human title ("Code civil — Livre 1er"), editable and independent of the filename. */
  title: string;
  filename: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  s3Key: string;
  status: LexAuthorityStatus;
  language?: string | null;
  pageCount?: number | null;
  /** Articles detected by the article-aware chunker — the citation anchors for law. */
  articleCount: number;
  /** When false the authority is stored and searchable but not injected into prompts. */
  enabled: boolean;
  /** Estimated tokens this authority's digest adds to EVERY chat turn. */
  digestTokens?: number | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One reserved authority upload — the same direct-to-S3 model as LexUploadSlot. */
export interface LexAuthorityUploadSlot {
  authority: LexAuthority;
  uploadUrl: string;
  contentType: string;
}

/**
 * The compressed, always-in-context index of an authority: an article-numbered map of what the
 * text contains, so the model knows which article to ask for without the full code in context.
 * A sub-resource — it is thousands of characters and must not ride along on list responses.
 */
export interface LexAuthorityDigest {
  authorityId: string;
  digest: string | null;
  digestTokens?: number | null;
  updatedAt: string;
}

// ── Background reasoning tasks ────────────────────────────────────────────────────────
// A long-running assessment over the whole case file. Runs in the background so the browser can
// be closed; its reasoning trace is persisted so it can be replayed on reconnect.

export type LexTaskStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

/**
 * `assess_documents` maps over every ready document, then synthesises a cited answer.
 *
 * `adverse_case` does the same traversal but reads the file AGAINST the user: it collects what the
 * documents assert contrary to the position she is defending, groups it by legal issue, and sets her
 * own material beside it. Whose side the app is on is STATED by her in the task title, never
 * inferred — everything else in this app refuses to assign a party a role, and a strategic view is
 * not a licence to start guessing one.
 */
export type LexTaskKind =
  /** Read every document and answer a question about the file. */
  | "assess_documents"
  /** Read every document AGAINST a named party, so her own counsel sees the case coming. */
  | "adverse_case"
  /**
   * Draft a document and verify every claim in it.
   *
   * A task rather than a request because the work outlives one: drafting reads up to 200 passages
   * and then each claim gets its own frontier-model judge, and nginx's default 60s read timeout on
   * the catch-all location cut that off long before it finished.
   */
  | "generate_artifact"
  /**
   * Re-verify an edited draft, so a corrected claim can reach `verified` again.
   *
   * Without this the edit path was a one-way door: saving a version resets it to `unverified`,
   * sign-off requires `verified`, and nothing could ever produce that second `verified`. Fixing a
   * claim therefore made the document permanently unfilable.
   *
   * A task for the SAME reason as generation, not for symmetry: the judge runs on the frontier
   * tier with reasoning, so a re-check of a rewritten sixteen-claim draft is sixteen of those
   * calls and would meet nginx's 60s read timeout — as a 504 with no CORS header, which the
   * browser reports as a CORS failure and hides the cause.
   */
  | "verify_artifact";

/** What a `generate_artifact` run needs beyond the title and instructions every task has. */
export interface LexArtifactTaskParams {
  type: LexArtifactType;
  /** Which pièces the drafter may use; absent means the whole case file. */
  documentIds?: string[];
  sourceMode?: "search" | "full";
}

/** Which document a `verify_artifact` run re-checks. Its current version is the one verified. */
export interface LexVerifyArtifactTaskParams {
  artifactId: string;
}

export type LexTaskParams =
  | LexArtifactTaskParams
  | LexVerifyArtifactTaskParams
  | Record<string, never>;

export interface LexTask {
  id: string;
  workspaceId: string;
  ownerEmail: string;
  /** The conversation the result is posted into. */
  conversationId?: string | null;
  kind: LexTaskKind;
  title: string;
  instructions?: string | null;
  /** How hard this run was allowed to think. Recorded so a result can be read against its cost. */
  depth: ReasoningDepth;
  /** Kind-specific inputs. Empty for the assessments, which need only title and instructions. */
  params?: LexTaskParams | null;
  /** The document a `generate_artifact` run produced, offered directly from the finished task. */
  resultArtifactId?: string | null;
  status: LexTaskStatus;
  progressDone: number;
  progressTotal: number;
  /** Human-readable current step, e.g. "reading Dagvaarding 2026 (12/47)". */
  step?: string | null;
  /** The assistant message the finished answer landed in. */
  resultMessageId?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LexTaskEventKind =
  | "reasoning"
  | "progress"
  | "finding"
  | "error"
  | "done";

/**
 * One entry in a task's persisted trace. Written in batches, never per token — a multi-minute
 * run would otherwise generate thousands of rows for no benefit.
 */
export interface LexTaskEvent {
  id: number;
  taskId: string;
  seq: number;
  kind: LexTaskEventKind;
  message: string;
  createdAt: string;
}

// ── Money events (the rapport ledger) ─────────────────────────────────────────────────
// Typed transmissions of money, extracted from the text the corpus already indexes, so the
// question a succession dispute actually turns on — who received what, when, for how much, and do
// the totals match — can be answered as arithmetic instead of as a list of files.
//
// THE TWO RULES THAT SHAPE EVERY TYPE BELOW:
//  1. `quote` is VERBATIM-GATED. It appeared inside the source chunk's stored text under the
//     deterministic backstop (quoteMatchesChunk, whitespace-normalised and case-insensitive) before
//     the row existed; an event whose quote did not match was dropped, never stored with a warning.
//  2. A party or an amount is present ONLY when the document states it. `fromName`, `toName`,
//     `amountOriginal` and `eventDate` are null when the text is silent, and that null is a
//     FINDING — in a rapport dispute a guessed recipient invents the very fact that decides the
//     shares. Every view must therefore render these rows rather than filter them out.
//
// As with LexDocumentChunk omitting `embedding`, the row's internal staleness bookkeeping
// (chunk_content_hash, page_text_hash) stays on the private backend Row and is not surfaced here:
// it exists so a re-index can re-anchor, and no client has any use for it.

/**
 * What kind of act moved the money. A closed vocabulary mirrored by a CHECK constraint and by
 * lexMoneyEventKindSchema — the three move together or an extraction aborts on an INSERT.
 *
 * The distinctions that are not cosmetic: `pret` is a repayable advance and is therefore not
 * reportable at all, so folding it into `paiement` would inflate an heir's balance with money he
 * owes back; `paiement` is the honest default for a transfer whose legal nature the text does not
 * state, because `don_manuel` asserts a gift and only the document may do that.
 */
export type LexMoneyEventKind =
  /** A hand gift, no deed — the core of a rapport dispute and the hardest to prove. */
  | "don_manuel"
  /** A donation by deed (notarial): same economic effect, different proof regime. */
  | "donation"
  | "vente"
  /** A loan. Repayable, hence outside rapport — never merge this with a gift or a payment. */
  | "pret"
  | "succession"
  /** An allotment in a division: the lots ARE the arithmetic. */
  | "partage"
  /** Money moved, legal nature not stated by the document. */
  | "paiement"
  | "jugement"
  | "autre";

/**
 * The currency as the era wrote it: the 1989-1998 acts are in Belgian francs (spelled BEF, FB or
 * "francs" in the corpus, all normalised to 'BEF' here), later ones in EUR.
 */
export type LexMoneyCurrency = "BEF" | "EUR";

/**
 * How much of `eventDate` the document actually stated. Many acts say only "en 1992": stored as
 * 1992-01-01 and rendered raw that reads as a specific day, which is a precision the text does not
 * have. A frise may position by the date; a ledger must format by this.
 */
export type LexMoneyDatePrecision = "day" | "month" | "year";

export interface LexMoneyEvent {
  id: string;
  documentId: string;
  /** Joined, not stored — the ledger's `pièce` column names the file the row came from. */
  filename: string;
  /**
   * The ACT's own date, which routinely differs from the document's timelineDate (a 1998 inventory
   * recites gifts made in 1989). Null when the text states none: the event is then undated, shown
   * at the end of the ledger, never filed under the document's date.
   */
  eventDate: string | null;
  /** Null exactly when `eventDate` is null. */
  eventDatePrecision: LexMoneyDatePrecision | null;
  kind: LexMoneyEventKind;
  /** As the document spells it. Null means THE DOCUMENT DOES NOT SAY — see rule 2 above. */
  fromName: string | null;
  toName: string | null;
  /**
   * The folded grouping keys, identical to the frontend's personKey (whitespace collapsed, case
   * folded, diacritics stripped), so "Monique PIRSON" and "Monique Pirson" aggregate as one heir.
   * The fold only merges spellings with the same letters in the same order: it refuses "M. Pirson"
   * → "Monique Pirson", because among five siblings sharing a surname a wrong merge invents a
   * person's involvement in a filing.
   */
  fromKey: string | null;
  toKey: string | null;
  /**
   * The amount AS THE DOCUMENT WROTE IT, in `currency`. A NUMERIC string, never a number: the
   * driver returns NUMERIC as a string and it must stay one end to end, because this feature exists
   * to make totals add up. Null exactly when `currency` is null — a figure whose currency the quote
   * does not state cannot be summed, and pretending otherwise is a 100x error waiting in a total.
   */
  amountOriginal: string | null;
  currency: LexMoneyCurrency | null;
  /**
   * The same amount converted at the fixed 1999 rate (see BEF_PER_EUR). DERIVED CONVENIENCE, NEVER
   * CITABLE, and it must reach the screen labelled INDICATIF: a 1992 franc and a 2019 euro are not
   * the same money, and the fixed rate ignores three decades of indexation. Computed by the
   * database, not by the extractor. Null when there is no amount or no currency.
   */
  amountEur: string | null;
  /**
   * What the sum was for, in a few words ("somme en liquide", "SANISTOCK"). A paraphrase, so it is
   * never the string a citation is verified against — `quote` is.
   */
  objectLabel: string | null;
  /**
   * The proof: verbatim from the document, in its own language and its own currency. Untranslated
   * and unreformatted on purpose — that is what makes it verifiable, and what a court is shown.
   */
  quote: string;
  /** Null when a re-index has since replaced the chunk the quote was proved against. */
  chunkId: string | null;
  /** The exact page, when the document has a page index. Both anchors may be set. */
  pageId: string | null;
  pageOrdinal: number | null;
  /** The coarse page range from the chunk — the fallback address for an un-page-indexed file. */
  pageFrom: number | null;
  pageTo: number | null;
  charStart: number | null;
  charEnd: number | null;
  /**
   * Folded identity of the ECONOMIC EVENT, not of the row: the same act is filed in three bundles
   * in a real court file, and three rows for one gift would treble an heir's balance. Rows sharing
   * a non-null value describe the same transmission. Nothing is hidden on this basis — the view
   * groups them in front of the reader, because deciding two filings are one act is her call.
   */
  duplicateKey: string | null;
  /** The model that read the passage, so a later pass is distinguishable rather than averaged in. */
  extractedBy: string | null;
  extractionVersion: number;
  /** The extractor's own 0-100 confidence. A sort and a filter, never a reason to hide a row. */
  confidence: number | null;
  createdAt: string;
}

/**
 * One bar of the per-heir balance: everything one person RECEIVED across the case file. The number
 * the dispute turns on, and therefore the number that must not overstate itself — which is why the
 * incompleteness counters travel with it instead of being computed somewhere the UI can forget.
 */
export interface LexMoneyHeirBalance {
  /** personKey — what the ledger's rows are grouped and filtered on. */
  key: string;
  /** The spelling the documents use most often, for the label. */
  name: string;
  /**
   * Sum of `amountEur` over the events naming this person as recipient. INDICATIVE, and the field
   * name says so because — unlike a single event — a sum across two currencies and three decades
   * has no original figure to stand beside it, so the caveat has nowhere else to live. A NUMERIC
   * string, so the total stays exact.
   */
  receivedEurIndicative: string;
  eventCount: number;
  /**
   * How many of those events state no amount. The bar understates by an unknown sum whenever this
   * is above zero, and a balance that does not say so is a balance that lies.
   */
  eventsWithoutAmount: number;
  /** How many were converted from BEF. The concrete justification for the INDICATIF label. */
  convertedFromBefCount: number;
  /** Events with no date, among this person's. Undated is not the same as absent. */
  undatedCount: number;
}

/**
 * Workspace-wide counts behind the ledger. Every one of these exists so the view can state what it
 * does NOT know: an artifact that looks complete and is not is worse than one that admits its gaps.
 */
export interface LexMoneyTotals {
  eventCount: number;
  /** Distinct documents contributing at least one event. */
  documentCount: number;
  datedCount: number;
  undatedCount: number;
  withAmountCount: number;
  withoutAmountCount: number;
  /** Events whose recipient the documents do not name — visible in the ledger, never filtered. */
  unknownRecipientCount: number;
  unknownGiverCount: number;
  /** Sum of every `amountEur`. INDICATIVE, same rule as LexMoneyHeirBalance. */
  totalEurIndicative: string;
  /** Events belonging to a duplicate group, i.e. rows the reader may want to collapse. */
  duplicateGroupedCount: number;
}

/**
 * How much of the case file the extraction has actually read. Modelled on LexPageIndexStatus:
 * `extracted`, `pending` and `blocked` are disjoint and sum to `total`, and `queued` is not a
 * fourth bucket — it is what distinguishes "the worker is chewing through the queue" from "the
 * worker is down and these numbers will never move".
 *
 * Workspace-scoped, unlike the page index, because a ledger is per case file: a total drawn from
 * one workspace's documents must be measured against that workspace's denominator.
 */
export interface LexMoneyCoverage {
  /** ready + active documents in the workspace — the same scope retrieval uses. */
  total: number;
  extracted: number;
  pending: number;
  queued: number;
  /** Extracted, with a recorded reason for having produced nothing usable. Needs a decision. */
  blocked: number;
  /**
   * Documents the deterministic money regex matches at all. Documents outside this set are not a
   * gap: they were read and contain no monetary figure, which is the expected answer for most of a
   * case file. It is here so `extracted` is not mistaken for the ledger's real denominator.
   */
  withMoneyText: number;
  /** Extraction generation the rows were produced by, so a stale ledger is visible as stale. */
  extractionVersion: number;
}

/**
 * The whole ledger in one response: hundreds of rows, fetched entirely and then sorted and filtered
 * client-side — the same choice the timeline makes, so the server's ordering wins and a column sort
 * costs no round-trip.
 */
export interface LexMoneyLedger {
  /** Oldest first, undated LAST (never dropped). */
  events: LexMoneyEvent[];
  /** Largest received first. Includes only named recipients; the unnamed live in `totals`. */
  balances: LexMoneyHeirBalance[];
  totals: LexMoneyTotals;
  coverage: LexMoneyCoverage;
}

/**
 * What a triggered extraction run committed to. `candidateChunks` is the deterministic prefilter's
 * count — the passages the regex matched, which is the only honest proxy for what the run will
 * cost, and the reason this response exists rather than a bare `{ queued }`: the spend is the
 * user's decision and she cannot make it without the number.
 */
export interface LexMoneyExtractionRun {
  /** Documents actually enqueued. Already-queued and already-extracted ones are skipped. */
  queued: number;
  /** ready + active documents in the workspace. */
  documentsInScope: number;
  /** Skipped because they are already at the current extraction version. */
  alreadyExtracted: number;
  /** Chunks in the enqueued documents that match the money regex — the model's input, in passages. */
  candidateChunks: number;
}

/** Links a claim (in a message OR an artifact version) to an exact source-chunk span. */
export interface LexCitation {
  id: string;
  ownerEmail: string;
  messageId?: string | null;
  artifactVersionId?: string | null;
  claimId?: string | null;
  chunkId?: string | null;
  documentId?: string | null;
  quote?: string | null;
  pageFrom?: number | null;
  pageTo?: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  chunkContentHash?: string | null;
  createdAt: string;
}

/**
 * One monetary amount a document states, with the text it was found in.
 *
 * DERIVED, and every field except `value`/`currency` is text the document itself contains: `raw` is
 * the matched substring and `excerpt` is a window of the surrounding sentence. There is deliberately
 * no payer and no payee — the file states sums, and attributing them is the practitioner's reading of
 * the page, not something this app may assert.
 */
export interface LexStoryAmount {
  documentId: string;
  /** The chunk the amount was found in, for anchoring back to the source span. */
  chunkId: string;
  value: number;
  /** ISO code. Convertibility is decided by the shared currency registry, not by this field. */
  currency: string;
  /** The matched text, exactly as written ("4.000.000 BEF"). */
  raw: string;
  /** A sentence-sized window of the document's own text around it. Whitespace-collapsed only. */
  excerpt: string;
  /** Offsets into the document's reconstructed text, so a page can be resolved. */
  charStart: number;
  charEnd: number;
  pageFrom: number | null;
  pageTo: number | null;
}

/**
 * A list the server cut, and the size it was cut from.
 *
 * Exists so a cap can never be applied silently: C8 requires a display cap to state what it hid, and
 * a subtraction done at the call site is a subtraction that can be forgotten. `total` is what the
 * scan found, `returned` is what travelled, `limit` is the rule that decided.
 */
export interface LexStoryCap {
  returned: number;
  total: number;
  limit: number;
}

/** Every cap the story read applied, in one place, because that is what the footer renders. */
export interface LexStoryCaps {
  facts: LexStoryCap;
  deathMentions: LexStoryCap;
  unpairedAmounts: LexStoryCap;
}

/** The case story read: what the file says about money, and how much of it was looked at. */
export interface LexStoryPayload {
  amounts: LexStoryAmount[];
  /** Dates written in the documents' text, most-cited first. */
  actDates: LexActDate[];
  /**
   * The registry: one entry per distinct date written in the text, chronological.
   *
   * A superset of `actDates` — same aggregation, plus the vocabulary, the exhibit references and the
   * amounts standing beside the date. `actDates` is kept so the existing view keeps working; a caller
   * building the registry reads this instead of joining the two lists in its head.
   */
  facts: LexFact[];
  /** Dates a document writes "décédé le …" in front of. Sorted by corroboration, then date. */
  deathMentions: LexDeathMention[];
  /** Distinct sums that never stand beside a date. What the registry structurally cannot show. */
  unpairedAmounts: LexUnpairedAmount[];
  /** How many distinct (currency, value) sums the scan found at all, paired or not. */
  distinctAmountCount: number;
  /** Mentions and documents per currency. The currency itself is evidence: BEF means a pre-2002 act. */
  amountCensus: LexCurrencyCount[];
  /**
   * In-scope documents that contributed NO date to the registry — the "separate pile".
   *
   * An undated document is never dropped from a chronology, it is quarantined visibly. When
   * `truncated` is true this list is an OVER-count: a document whose only dated chunks fell past the
   * cap looks undated from here.
   */
  undatedDocumentIds: string[];
  caps: LexStoryCaps;
  chunksScanned: number;
  /** True when the scan hit its cap; the amounts shown are then a prefix, not the whole file. */
  truncated: boolean;
  chunkLimit: number;
}

/** One sighting of a date, in the document that writes it. */
export interface LexActDateSample {
  documentId: string;
  /** The date exactly as written ("27 mai 1998", "15/6/98"). */
  raw: string;
  /** A window of the document's own text around it. A substring, never a rewrite. */
  excerpt: string;
  chunkId: string;
  pageFrom: number | null;
}

/**
 * A date written INSIDE the documents — an act, not a filing.
 *
 * The distinction is the point: a 2024 set of conclusions describing a 1996 purchase and a 1998 death
 * appears on a filing chronology only in 2024, so on a file spanning decades the legal facts hide
 * inside recent pleadings. Measured on a real corpus, 1998 carries 451 date mentions against 7
 * documents filed that year.
 */
export interface LexActDate {
  iso: string;
  /** How many separate documents state this date — the best available signal of its weight. */
  documentCount: number;
  mentionCount: number;
  /** True when ANY sighting had its century inferred from a two-digit year. */
  yearInferred: boolean;
  /** One sighting per document, capped; the UI says when it is showing fewer than exist. */
  samples: LexActDateSample[];
}

/**
 * A sum standing beside a date in the text, and how many documents write that pair.
 *
 * IT IS AN ADJACENCY, NOT A TRANSACTION. The scan found this figure within a few dozen characters of
 * this date, in a sentence the excerpt quotes in full; it does not say the sum was paid on that day,
 * that it is a donation rather than an account balance, or who moved it. Belgian succession law values
 * a liberality at the date of the donation, so (date, amount, currency) is the unit a practitioner
 * reasons in — which is why the pair is shown at all, and why the excerpt travels with it so she can
 * see for herself what the sentence actually says.
 */
export interface LexFactAmount {
  value: number;
  /** ISO code. Convertibility is decided by the shared currency registry, not by this field. */
  currency: string;
  /** The matched text, exactly as written ("1.500.000 BEF"). */
  raw: string;
  /** How many separate documents write this sum beside this date. */
  documentCount: number;
  /** The sentence the pair was found in. A substring of the document, whitespace-collapsed. */
  excerpt: string;
  documentId: string;
  chunkId: string;
  pageFrom: number | null;
}

/**
 * One row of the registry: a date the file writes, everything the text puts next to it.
 *
 * WHAT THE BADGES MEAN. `notions`, `qualifications` and `milestones` are ids from the shared legal
 * vocabulary, found as literal words within a window of the date. They say THE WORD IS THERE and
 * nothing more — never that a liberality is rapportable, that a réserve is breached, or that anyone
 * concealed anything. `refs` are exhibit citations exactly as written ("annexe 13"), never resolved to
 * a document: the numbering is per party and per filing and it collides, and a wrong pièce number in
 * conclusions filed under art. 744 C. jud. is worse than none.
 */
export interface LexFact {
  iso: string;
  /** How many separate documents state this date. The only weight available without reading. */
  documentCount: number;
  mentionCount: number;
  /** True when ANY sighting had its century inferred from a two-digit year. */
  yearInferred: boolean;
  /** One sighting per document, capped; `documentCount` says how many exist. */
  samples: LexActDateSample[];
  /** Sums standing beside the date, best-corroborated first. Capped — see `amountCount`. */
  amounts: LexFactAmount[];
  /** Distinct sums joined to this date, before `amounts` was capped. */
  amountCount: number;
  notions: string[];
  qualifications: string[];
  milestones: string[];
  /** Literal exhibit references found near the date, first appearance first. */
  refs: string[];
}

/**
 * A date a document writes a death trigger directly in front of ("décédé le 27 mai 1998").
 *
 * The date of death decides which succession law governs a whole file, so this is deliberately the
 * strictest derivation in the payload: the trigger must run right up to the date. It reports that N
 * documents write this sentence and stops. It does NOT say whose succession opened, which régime
 * applies, or what any prescription horizon is — the first is a role this app never assigns, the other
 * two are legal conclusions no pattern can reach. A caller displaying these applies its own
 * corroboration floor; a single-document mention is returned so the floor is the UI's choice, stated,
 * rather than a silent server-side filter.
 */
export interface LexDeathMention {
  iso: string;
  documentCount: number;
  mentionCount: number;
  yearInferred: boolean;
  samples: LexActDateSample[];
}

/**
 * A distinct sum that never stands beside a date anywhere in the file.
 *
 * The registry's spine is the date, so these figures have no row to live in. They are listed rather
 * than dropped: on the real corpus most distinct sums are unpaired, and a ledger that hid them while
 * claiming to be the file's money would be the more misleading artefact.
 */
export interface LexUnpairedAmount {
  value: number;
  currency: string;
  /** The matched text, exactly as written. */
  raw: string;
  /** How many separate documents state this sum. */
  documentCount: number;
  /** One sighting's sentence, so even an unpaired figure is verifiable. */
  excerpt: string;
  documentId: string;
  chunkId: string;
  pageFrom: number | null;
}

/** How much of the file is written in one currency. BEF in a 2024 filing dates the act it discusses. */
export interface LexCurrencyCount {
  currency: string;
  mentionCount: number;
  documentCount: number;
}
