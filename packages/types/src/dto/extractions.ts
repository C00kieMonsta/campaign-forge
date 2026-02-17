// src/dto/extractions.ts

// Import constants from utils (these could be moved to types/constants later)
import { z } from "zod";
import {
  ASYNC_JOB_STATUSES_VALUES,
  EXTRACTION_JOB_TYPES_VALUES,
  VERIFICATION_STATUSES_VALUES
} from "../constants";
import { ExtractionJobSchema } from "../entities/extraction_job";
import {
  ExtractionResult,
  ExtractionResultSchema
} from "../entities/extraction_result";
import {
  ExtractionSchema,
  ExtractionSchemaSchema
} from "../entities/extraction_schema";
import { Uuid } from "./primitives";

// ---- Extraction Job Type and Status Enums
export const ExtractionJobType = z.enum(EXTRACTION_JOB_TYPES_VALUES);
export type ExtractionJobType = z.infer<typeof ExtractionJobType>;

export const ExtractionJobStatus = z.enum(ASYNC_JOB_STATUSES_VALUES);
export type ExtractionJobStatus = z.infer<typeof ExtractionJobStatus>;

export const ExtractionResultStatus = z.enum(VERIFICATION_STATUSES_VALUES);
export type ExtractionResultStatus = z.infer<typeof ExtractionResultStatus>;

// ---- StartExtractionJobRequest
export const StartExtractionJobRequestSchema = z
  .object({
    dataLayerId: Uuid.optional(), // For backward compatibility with single file
    dataLayerIds: z.array(Uuid).optional(), // For multiple files
    jobType: ExtractionJobType.default("material_extraction"),
    config: z.record(z.any()).optional(), // AI model settings, etc.
    schemaId: Uuid // REQUIRED: must reference an ExtractionSchema
  })
  .refine(
    (data) =>
      data.dataLayerId || (data.dataLayerIds && data.dataLayerIds.length > 0),
    {
      message:
        "Either dataLayerId or dataLayerIds (with at least one ID) must be provided",
      path: ["dataLayerId", "dataLayerIds"]
    }
  );
export type StartExtractionJobRequest = z.infer<
  typeof StartExtractionJobRequestSchema
>;

// ---- UpdateExtractionResultRequest
export const UpdateExtractionResultRequestSchema = z.object({
  materialName: z.string().min(1).max(255).optional(),
  materialDescription: z.string().max(1000).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().max(50).optional(),
  dimensions: z
    .object({
      length: z.number().positive().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      diameter: z.number().positive().optional(),
      thickness: z.number().positive().optional(),
      radius: z.number().positive().optional(),
      unit: z.string().optional()
    })
    .optional(),
  specifications: z.record(z.any()).optional()
});
export type UpdateExtractionResultRequest = z.infer<
  typeof UpdateExtractionResultRequestSchema
>;

// ---- ExtractionJobListResponse
export const ExtractionJobListResponseSchema = z.object({
  extractionJobs: z.array(ExtractionJobSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number()
});
export type ExtractionJobListResponse = z.infer<
  typeof ExtractionJobListResponseSchema
>;

// ---- ExtractionResultListResponse
export const ExtractionResultListResponseSchema = z.object({
  extractionResults: z.array(ExtractionResultSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number()
});
export type ExtractionResultListResponse = z.infer<
  typeof ExtractionResultListResponseSchema
>;

// ---- Enhanced CRUD Operations for Extraction Results
export const UpdateExtractionResultStatusRequestSchema = z.object({
  resultId: z.string(),
  status: ExtractionResultStatus,
  notes: z.string().optional()
});
export type UpdateExtractionResultStatusRequest = z.infer<
  typeof UpdateExtractionResultStatusRequestSchema
>;

export const EditExtractionResultRequestSchema = z.object({
  resultId: z.string(),
  itemCode: z.string().optional(),
  itemName: z.string().optional(),
  technicalSpecifications: z.string().optional(),
  executionNotes: z.string().optional(),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  additionalNotes: z.string().optional()
});
export type EditExtractionResultRequest = z.infer<
  typeof EditExtractionResultRequestSchema
>;

export const DeleteExtractionResultRequestSchema = z.object({
  resultId: z.string(),
  reason: z.string().optional()
});
export type DeleteExtractionResultRequest = z.infer<
  typeof DeleteExtractionResultRequestSchema
>;

export const BulkUpdateExtractionResultsRequestSchema = z.object({
  jobId: Uuid,
  updates: z.array(
    z.object({
      resultId: z.string(),
      status: ExtractionResultStatus.optional(),
      itemCode: z.string().optional(),
      itemName: z.string().optional(),
      technicalSpecifications: z.string().optional(),
      executionNotes: z.string().optional(),
      quantity: z.number().optional(),
      unit: z.string().optional(),
      additionalNotes: z.string().optional()
    })
  )
});
export type BulkUpdateExtractionResultsRequest = z.infer<
  typeof BulkUpdateExtractionResultsRequestSchema
>;

// ---- Units of Measurement
export const UnitOfMeasurementSchema = z.object({
  id: Uuid,
  symbol: z.string(),
  name: z.string(),
  category: z.string().optional(),
  isCommon: z.boolean().default(false),
  createdAt: z.date()
});
export type UnitOfMeasurement = z.infer<typeof UnitOfMeasurementSchema>;

export const UnitsOfMeasurementListResponseSchema = z.object({
  units: z.array(UnitOfMeasurementSchema),
  categories: z.array(z.string())
});
export type UnitsOfMeasurementListResponse = z.infer<
  typeof UnitsOfMeasurementListResponseSchema
>;

// ---- Download Enhanced Extractions
export const DownloadExtractionResultsRequestSchema = z.object({
  jobId: Uuid,
  format: z.enum(["csv", "xlsx", "json"]).default("csv"),
  includeRejected: z.boolean().default(false),
  includeSnippets: z.boolean().default(false)
});
export type DownloadExtractionResultsRequest = z.infer<
  typeof DownloadExtractionResultsRequestSchema
>;

// Enhanced extraction result with evidence and verification
export const ExtractionResultWithEvidenceSchema = z.object({
  id: z.string(),
  extractionJobId: z.string(),

  // Raw AI extraction (immutable)
  rawExtraction: z.record(z.any()),

  // Evidence of extraction source
  evidence: z.object({
    boundingBox: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
        page: z.number().int().positive().optional()
      })
      .optional(),
    sourceText: z.string().optional(),
    contextText: z.string().optional(),
    ocrConfidence: z.number().min(0).max(1).optional(),
    extractionMethod: z
      .enum(["vision-only", "ocr-enhanced", "hybrid"])
      .optional(),
    locationInDocument: z.string().optional(),
    metadata: z.record(z.any()).optional()
  }),

  // Human-verified data (can be edited)
  verifiedData: z.record(z.any()).optional(),

  // Status and metadata
  status: ExtractionResultStatus,
  confidenceScore: z.number().min(0).max(1).optional(),
  pageNumber: z.number().int().positive().optional(),
  locationInDoc: z.string().optional(),

  // Indexed fields
  itemCode: z.string().optional(),
  itemName: z.string().optional(),
  quantity: z.number().optional(),
  unit: z.string().optional(),

  // Verification tracking
  verifiedBy: z.string().optional(),
  verifiedAt: z.date().optional(),
  verificationNotes: z.string().optional(),

  // Audit fields
  editedBy: z.string().optional(),
  editedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});
export type ExtractionResultWithEvidence = z.infer<
  typeof ExtractionResultWithEvidenceSchema
>;

// Request schema for verification
export const VerifyExtractionResultRequestSchema = z.object({
  verifiedData: z.record(z.any()),
  verificationNotes: z.string().optional(),
  status: ExtractionResultStatus.optional()
});
export type VerifyExtractionResultRequest = z.infer<
  typeof VerifyExtractionResultRequestSchema
>;

// ---- V2 Extraction API Schemas ----

// Update extraction result
export const UpdateResultRequestSchema = z.object({
  data: z.record(z.any()).optional(),
  status: ExtractionResultStatus.optional()
});
export type UpdateResultRequest = z.infer<typeof UpdateResultRequestSchema>;

// Update result status only
export const UpdateResultStatusRequestSchema = z.object({
  status: ExtractionResultStatus
});
export type UpdateResultStatusRequest = z.infer<
  typeof UpdateResultStatusRequestSchema
>;

// Create manual extraction result
export const CreateManualResultRequestSchema = z.object({
  jobId: Uuid,
  data: z.record(z.any()),
  pageNumber: z.number().int().positive().optional(),
  locationInDoc: z.string().optional(),
  originalSnippet: z.string().optional(),
  notes: z.string().optional()
});
export type CreateManualResultRequest = z.infer<
  typeof CreateManualResultRequestSchema
>;

// Delete results (bulk)
export const DeleteResultsRequestSchema = z.object({
  resultIds: z.array(Uuid).min(1)
});
export type DeleteResultsRequest = z.infer<typeof DeleteResultsRequestSchema>;

// Merge results
export const MergeResultsRequestSchema = z.object({
  primaryId: Uuid,
  secondaryIds: z.array(Uuid).min(1),
  mergedData: z.record(z.any())
});
export type MergeResultsRequest = z.infer<typeof MergeResultsRequestSchema>;

// Get job results response
export const GetJobResultsResponseSchema = z.object({
  results: z.array(ExtractionResultWithEvidenceSchema),
  schema: ExtractionSchemaSchema.nullable()
});
export type GetJobResultsResponse = z.infer<typeof GetJobResultsResponseSchema>;

// Results statistics response
export const ResultsStatsResponseSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.number()),
  averageConfidence: z.number().optional(),
  pendingCount: z.number()
});
export type ResultsStatsResponse = z.infer<typeof ResultsStatsResponseSchema>;

// Verification statistics response
export const VerificationStatsResponseSchema = z.object({
  totalResults: z.number(),
  verifiedCount: z.number(),
  pendingCount: z.number(),
  acceptedCount: z.number(),
  rejectedCount: z.number(),
  editedCount: z.number(),
  verificationRate: z.number()
});
export type VerificationStatsResponse = z.infer<
  typeof VerificationStatsResponseSchema
>;

// Result evidence response
export const ResultEvidenceResponseSchema = z.object({
  evidence: z.record(z.any()),
  resultId: Uuid,
  hasEvidence: z.boolean()
});
export type ResultEvidenceResponse = z.infer<
  typeof ResultEvidenceResponseSchema
>;
