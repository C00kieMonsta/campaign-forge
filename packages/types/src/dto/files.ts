// src/dto/files.ts
import { z } from "zod";
import { DataLayer, DataLayerSchema } from "../entities/data_layer";
import { Uuid } from "./primitives";

// ---- FileUploadRequest
export const FileUploadRequestSchema = z.object({
  projectId: Uuid,
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  fileType: z.string().min(1).max(50), // pdf, docx, image, etc.
  s3Key: z.string().min(1), // S3 object key
  fileSize: z.number().positive().optional(),
  fileHash: z.string().optional() // SHA256 hash for deduplication
  // Note: actual file upload is handled via presigned URLs
});
export type FileUploadRequest = z.infer<typeof FileUploadRequestSchema>;

// ---- FileUploadResponse
export const FileUploadResponseSchema = z.object({
  dataLayer: DataLayerSchema,
  uploadUrl: z.string().url().optional() // presigned URL if needed
});
export type FileUploadResponse = z.infer<typeof FileUploadResponseSchema>;

// ---- BatchFileUploadRequest
export const BatchFileUploadRequestSchema = z.object({
  projectId: Uuid,
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().max(1000).optional(),
        fileType: z.string().min(1).max(50), // pdf, docx, image, etc.
        s3Key: z.string().min(1), // S3 object key
        fileSize: z.number().positive().optional(),
        fileHash: z.string().optional() // SHA256 hash for deduplication
      })
    )
    .min(1)
    .max(100) // Allow 1-100 files in a batch
});
export type BatchFileUploadRequest = z.infer<
  typeof BatchFileUploadRequestSchema
>;

// ---- BatchFileUploadResponse
export const BatchFileUploadResponseSchema = z.object({
  dataLayers: z.array(DataLayerSchema),
  totalUploaded: z.number(),
  errors: z
    .array(
      z.object({
        fileName: z.string(),
        error: z.string()
      })
    )
    .optional()
});
export type BatchFileUploadResponse = z.infer<
  typeof BatchFileUploadResponseSchema
>;

// ---- DataLayerListResponse
export const DataLayerListResponseSchema = z.object({
  dataLayers: z.array(DataLayerSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number()
});
export type DataLayerListResponse = z.infer<typeof DataLayerListResponseSchema>;

// ---- UploadProgress
export const UploadProgressSchema = z.object({
  fileName: z.string(),
  progress: z.number().min(0).max(100),
  status: z.enum(["uploading", "processing", "completed", "error"]),
  error: z.string().optional(),
  uploadSpeed: z.number().optional(),
  estimatedTimeRemaining: z.number().optional(),
  startTime: z.number().optional()
});
export type UploadProgress = z.infer<typeof UploadProgressSchema>;

// ---- FileUploadResult
export const FileUploadResultSchema = z.object({
  fileName: z.string(),
  s3Key: z.string(),
  fileSize: z.number(),
  contentType: z.string(),
  dataLayerId: Uuid.optional(),
  uploadDuration: z.number().optional()
});
export type FileUploadResult = z.infer<typeof FileUploadResultSchema>;

// ---- BatchUploadResult
export const BatchUploadResultSchema = z.object({
  dataLayerIds: z.array(Uuid),
  totalUploaded: z.number(),
  errors: z
    .array(
      z.object({
        fileName: z.string(),
        error: z.string()
      })
    )
    .optional()
});
export type BatchUploadResult = z.infer<typeof BatchUploadResultSchema>;

// ---- FileUploadWithExtractionState
export const FileUploadWithExtractionStateSchema = z.object({
  phase: z.enum([
    "idle",
    "uploading",
    "starting-extraction",
    "extracting",
    "completed",
    "error"
  ]),
  uploads: z.array(UploadProgressSchema),
  extractionJobId: Uuid.nullable(),
  error: z.string().nullable(),
  totalProgress: z.number().min(0).max(100)
});
export type FileUploadWithExtractionState = z.infer<
  typeof FileUploadWithExtractionStateSchema
>;

// ---- ProgressInfo (for extraction job status)
export const ProgressInfoSchema = z.object({
  percentage: z.number().optional(),
  status: z.string(),
  isActive: z.boolean(),
  isCompleted: z.boolean(),
  isFailed: z.boolean(),
  isCancelled: z.boolean(),
  errorMessage: z.string().nullable().optional(),
  startedAt: z.date().nullable().optional(),
  completedAt: z.date().nullable().optional()
});
export type ProgressInfo = z.infer<typeof ProgressInfoSchema>;
