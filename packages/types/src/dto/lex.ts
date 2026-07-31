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

// ── Streaming (SSE) contract for the chat endpoint ──────────────────────────────────────
export const lexCitationEventSchema = z.object({
  /** 1-based marker index the assistant used inline, e.g. [1]. */
  index: z.number().optional(),
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
