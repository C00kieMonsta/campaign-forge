import { z } from "zod";

// ── Workspaces ────────────────────────────────────────────────────────────────────────
export const createWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional()
});
export type CreateWorkspaceRequest = z.infer<
  typeof createWorkspaceRequestSchema
>;

export const updateWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.string().min(1).optional()
});
export type UpdateWorkspaceRequest = z.infer<
  typeof updateWorkspaceRequestSchema
>;

// ── Settings ──────────────────────────────────────────────────────────────────────────
export const lexLanguageSchema = z.enum(["fr", "nl"]);

export const updateSettingsRequestSchema = z.object({
  language: lexLanguageSchema
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

// ── Documents ─────────────────────────────────────────────────────────────────────────
// A hand-corrected voice-note transcript. Generous cap: 30 minutes of speech is ~30k chars.
export const updateTranscriptRequestSchema = z.object({
  transcript: z.string().max(200000)
});
export type UpdateTranscriptRequest = z.infer<
  typeof updateTranscriptRequestSchema
>;

/** Hard ceiling per document, mirrored on the client so a bad drop fails before uploading. */
export const MAX_DOCUMENT_BYTES = 200 * 1024 * 1024;
/** Files accepted in one presign batch — a folder drop is chunked to this. */
export const MAX_UPLOAD_BATCH = 50;

// Documents are uploaded straight to S3 with a presigned PUT: the client asks for slots, PUTs
// the bytes itself, then confirms. `sourcePath` carries the folder path when a folder was
// dropped, so a flattened name can be traced back to where it came from.
export const presignUploadRequestSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(500),
        contentType: z.string().max(200).optional(),
        size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
        sourcePath: z.string().max(1000).optional()
      })
    )
    .min(1)
    .max(MAX_UPLOAD_BATCH)
});
export type PresignUploadRequest = z.infer<typeof presignUploadRequestSchema>;

export const completeUploadRequestSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(MAX_UPLOAD_BATCH)
});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;

// Multi-select deletion. Capped generously — clearing a mis-dropped folder of 200 files should
// be one action, not four.
export const deleteDocumentsRequestSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(500)
});
export type DeleteDocumentsRequest = z.infer<
  typeof deleteDocumentsRequestSchema
>;

/**
 * Multi-select archive, and its inverse. Archiving sets lifecycle_state 'archived', which every
 * retrieval path already excludes, so a document leaves search and chat without being destroyed —
 * the row, the S3 object and every citation anchored to it survive. Restore is the same shape, so
 * both routes share this schema.
 *
 * Capped like bulk-delete: a select-all over a whole case file must be one request. The cap is only
 * a guard against an absurd body — unlike bulk-delete, nothing here is destructive.
 */
export const MAX_LIFECYCLE_BATCH = 500;
export const archiveDocumentsRequestSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(MAX_LIFECYCLE_BATCH)
});
export type ArchiveDocumentsRequest = z.infer<
  typeof archiveDocumentsRequestSchema
>;

/**
 * How a documents read treats ARCHIVED documents — sent as `?archived=` on the list and timeline
 * reads, absent meaning "exclude".
 *
 * Archived-ness is the only axis this can express, deliberately: 'superseded' duplicates have
 * always come back from these reads (the documents view labels them "doublon de …" and hides them
 * behind its own toggle), and a scope that could also drop them would change a behaviour the
 * archive feature has no business touching.
 */
export const lexArchivedScopeSchema = z.enum(["exclude", "only", "include"]);
export type LexArchivedScope = z.infer<typeof lexArchivedScopeSchema>;

/**
 * Bulk-discard by status. Only the two states that are genuinely disposable are allowed:
 * `awaiting_upload` (bytes never arrived, nothing to retry) and `failed`/`duplicate`. A 'ready'
 * document is never deletable this way — losing a filed exhibit to a mis-click is not acceptable.
 */
export const discardDocumentsRequestSchema = z.object({
  statuses: z
    .array(z.enum(["awaiting_upload", "failed", "duplicate"]))
    .min(1)
    .max(3)
});
export type DiscardDocumentsRequest = z.infer<
  typeof discardDocumentsRequestSchema
>;

// ── Authorities ───────────────────────────────────────────────────────────────────────
// Same direct-to-S3 upload shape as documents; authorities are owner-scoped so there is no
// workspace in the path.
export const presignAuthorityRequestSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(500),
        title: z.string().min(1).max(300).optional(),
        contentType: z.string().max(200).optional(),
        size: z.number().int().positive().max(MAX_DOCUMENT_BYTES)
      })
    )
    .min(1)
    .max(MAX_UPLOAD_BATCH)
});
export type PresignAuthorityRequest = z.infer<
  typeof presignAuthorityRequestSchema
>;

export const completeAuthorityUploadRequestSchema = z.object({
  authorityIds: z.array(z.string().uuid()).min(1).max(MAX_UPLOAD_BATCH)
});
export type CompleteAuthorityUploadRequest = z.infer<
  typeof completeAuthorityUploadRequestSchema
>;

export const updateAuthorityRequestSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  /** Disable to keep an authority stored and searchable but out of every prompt. */
  enabled: z.boolean().optional()
});
export type UpdateAuthorityRequest = z.infer<
  typeof updateAuthorityRequestSchema
>;

// ── Background reasoning tasks ────────────────────────────────────────────────────────
export const createTaskRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  kind: z.enum(["assess_documents"]).default("assess_documents"),
  title: z.string().min(1).max(300),
  instructions: z.string().max(4000).optional()
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/** SSE frames for watching a running task. `replay` events precede live ones. */
export const lexTaskStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("event"),
    seq: z.number(),
    kind: z.enum(["reasoning", "progress", "finding", "error", "done"]),
    message: z.string()
  }),
  z.object({
    type: z.literal("status"),
    status: z.enum(["queued", "running", "done", "failed", "cancelled"]),
    progressDone: z.number(),
    progressTotal: z.number(),
    step: z.string().nullable().optional()
  }),
  z.object({ type: z.literal("closed") })
]);
export type LexTaskStreamEvent = z.infer<typeof lexTaskStreamEventSchema>;

// ── Conversations ─────────────────────────────────────────────────────────────────────
export const createConversationRequestSchema = z.object({
  title: z.string().max(200).optional()
});
export type CreateConversationRequest = z.infer<
  typeof createConversationRequestSchema
>;

/**
 * Pages the user pinned in the viewer. These are not a hint in the prose — they CONSTRAIN
 * retrieval: the pinned pages' chunks are read verbatim and occupy the first source slots, so
 * "what does this say?" about pages 7-9 actually reads pages 7-9 instead of hoping the vector
 * search happens to surface them.
 */
export const lexPinSchema = z.object({
  documentId: z.string().uuid(),
  /** 1-based page numbers. Empty means the whole document. */
  pages: z.array(z.number().int().positive().max(100000)).max(200)
});
export type LexPin = z.infer<typeof lexPinSchema>;

export const sendMessageRequestSchema = z.object({
  content: z.string().min(1),
  pins: z.array(lexPinSchema).max(20).optional()
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const renameConversationRequestSchema = z.object({
  title: z.string().min(1).max(200)
});
export type RenameConversationRequest = z.infer<
  typeof renameConversationRequestSchema
>;

// ── Artifacts ─────────────────────────────────────────────────────────────────────────
export const generateArtifactRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  type: z.enum(["memo", "chronology", "submission"]),
  title: z.string().min(1).max(200),
  instructions: z.string().max(4000).optional()
});
export type GenerateArtifactRequest = z.infer<
  typeof generateArtifactRequestSchema
>;

// Validated artifact body (mirrors the LexArtifactBody entity) — so a save cannot persist
// arbitrary JSON as a court-document body.
export const lexArtifactClaimSchema = z.object({
  claimId: z.string(),
  text: z.string(),
  status: z.enum(["supported", "unsupported", "contradicted"]),
  citation: z
    .object({
      chunkId: z.string(),
      documentId: z.string(),
      filename: z.string(),
      pageFrom: z.number().nullable(),
      pageTo: z.number().nullable(),
      quote: z.string()
    })
    .nullable()
    .optional()
});
export const lexArtifactBodySchema = z.object({
  type: z.literal("lex-artifact"),
  claims: z.array(lexArtifactClaimSchema)
});

export const saveArtifactRequestSchema = z.object({
  bodyJson: lexArtifactBodySchema
});
export type SaveArtifactRequest = z.infer<typeof saveArtifactRequestSchema>;

// ── Money events (the rapport ledger) ─────────────────────────────────────────────────
/**
 * The act vocabulary. THIS ENUM, the `lex_money_events_kind_check` CHECK constraint and the
 * LexMoneyEventKind union are one contract in three places: they must be changed together, because
 * a value the model may emit and the database refuses aborts an INSERT and loses the batch.
 *
 * Exported here rather than kept in the extractor so the model-response schema, the HTTP filter and
 * the UI's dropdown all read the same list — `lexMoneyEventKindSchema.options` is that list.
 */
export const lexMoneyEventKindSchema = z.enum([
  "don_manuel",
  "donation",
  "vente",
  /** Repayable, therefore outside rapport — never folded into a gift or a payment. */
  "pret",
  "succession",
  "partage",
  /** Money moved, legal nature not stated. The honest default; 'don_manuel' asserts a gift. */
  "paiement",
  "jugement",
  "autre"
]);

/** BEF covers the corpus's 'FB' and 'francs' spellings; both normalise to this one value. */
export const lexMoneyCurrencySchema = z.enum(["BEF", "EUR"]);

/** How much of a date the document stated — "en 1992" is a year, not the 1st of January. */
export const lexMoneyDatePrecisionSchema = z.enum(["day", "month", "year"]);

/**
 * The irrevocable conversion rate fixed on 31 December 1998: 40.3399 BEF = 1 EUR.
 *
 * A STRING, deliberately. The only correct place to divide by this is Postgres NUMERIC — it is the
 * literal inside the generated `amount_eur` column, and the two must be changed together. Exporting
 * it as a JS number would invite a float division somewhere in the client, which is precisely the
 * lost exactness this feature exists to prevent. It is exported so the UI can name the rate in its
 * "montant indicatif" caveat, which every converted figure must carry: a 1992 franc and a 2019 euro
 * are not the same money, and this rate ignores three decades of indexation.
 */
export const BEF_PER_EUR = "40.3399";

/**
 * Triggers the extraction pass. The workspace comes from the path; this body only narrows.
 *
 * `force` exists because the pass costs real money: without it a re-run silently skips every
 * document already at the current extraction version, which is what you want after adding files and
 * not what you want after changing the prompt. Defaulted to false so the cheap behaviour is the one
 * you get by not thinking about it.
 */
export const extractMoneyEventsRequestSchema = z.object({
  /** Absent means every ready + active document in the workspace. */
  documentIds: z.array(z.string().uuid()).min(1).max(500).optional(),
  force: z.boolean().default(false)
});
export type ExtractMoneyEventsRequest = z.infer<
  typeof extractMoneyEventsRequestSchema
>;

// ── Streaming (SSE) contract for the chat endpoint ──────────────────────────────────────
export const lexCitationEventSchema = z.object({
  /** 1-based marker index the assistant used inline, e.g. [1]. */
  index: z.number().optional(),
  /**
   * OPAQUE source identity, table-prefixed ("chunk:<uuid>" / "page:<uuid>") — NOT a foreign key.
   * A cited span can live in lex_document_chunks or lex_document_pages, which are different tables
   * with different foreign keys in lex_citations, so this field cannot be a bare id. The prefix is
   * deliberate: if anyone does try to use it as an FK, Postgres rejects it as invalid uuid syntax
   * rather than silently violating a constraint mid-transaction, which is how the untyped version
   * of this field cost a user a complete answer.
   */
  chunkId: z.string(),
  documentId: z.string(),
  filename: z.string().optional(),
  pageFrom: z.number().nullable().optional(),
  pageTo: z.number().nullable().optional(),
  quote: z.string().optional()
});
export type LexCitationEvent = z.infer<typeof lexCitationEventSchema>;

export const lexStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("token"), delta: z.string() }),
  z.object({
    type: z.literal("citations"),
    citations: z.array(lexCitationEventSchema)
  }),
  z.object({ type: z.literal("done"), messageId: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() })
]);
export type LexStreamEvent = z.infer<typeof lexStreamEventSchema>;
