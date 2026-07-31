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

export type LexClaimStatus = "supported" | "unsupported" | "contradicted";

/** A single factual claim in a generated artifact, anchored to a source span (or flagged). */
export interface LexArtifactClaim {
  claimId: string;
  text: string;
  status: LexClaimStatus;
  citation?: {
    chunkId: string;
    documentId: string;
    filename: string;
    pageFrom: number | null;
    pageTo: number | null;
    quote: string;
  } | null;
}

/** The stored artifact body (a structured, citation-anchored document). */
export interface LexArtifactBody {
  type: "lex-artifact";
  claims: LexArtifactClaim[];
}

export interface LexArtifactVerificationReport {
  total: number;
  supported: number;
  unsupported: number;
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

/** `assess_documents` maps over every ready document, then synthesises a cited answer. */
export type LexTaskKind = "assess_documents";

export interface LexTask {
  id: string;
  workspaceId: string;
  ownerEmail: string;
  /** The conversation the result is posted into. */
  conversationId?: string | null;
  kind: LexTaskKind;
  title: string;
  instructions?: string | null;
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
