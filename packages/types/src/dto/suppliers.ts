// src/dto/suppliers.ts
import { z } from "zod";
import { SupplierSchema } from "../entities/supplier";
import { SupplierMatchSchema } from "../entities/supplier_match";
import { AddressSchema } from "./clients";
import { Email, Uuid } from "./primitives";

// ---- CreateSupplierRequest
export const CreateSupplierRequestSchema = z.object({
  name: z.string().min(1).max(255),
  contactName: z.string().max(100).optional(),
  contactEmail: Email,
  contactPhone: z.string().max(20).optional(),
  address: AddressSchema.optional(),
  materialsOffered: z.array(z.string()).optional()
});
export type CreateSupplierRequest = z.infer<typeof CreateSupplierRequestSchema>;

// ---- UpdateSupplierRequest
export const UpdateSupplierRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  contactName: z.string().max(100).optional(),
  contactEmail: Email.optional(),
  contactPhone: z.string().max(20).optional(),
  address: AddressSchema.optional(),
  materialsOffered: z.array(z.string()).optional()
});
export type UpdateSupplierRequest = z.infer<typeof UpdateSupplierRequestSchema>;

// ---- SupplierListResponse
export const SupplierListResponseSchema = z.object({
  suppliers: z.array(SupplierSchema),
  total: z.number(),
  page: z.number().optional(),
  limit: z.number().optional()
});
export type SupplierListResponse = z.infer<typeof SupplierListResponseSchema>;

// ---- SelectSupplierMatchRequest
export const SelectSupplierMatchRequestSchema = z.object({
  isSelected: z.boolean()
});
export type SelectSupplierMatchRequest = z.infer<
  typeof SelectSupplierMatchRequestSchema
>;

// ---- Attachment schema for email composition
export const AttachmentSchema = z.object({
  id: Uuid,
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  url: z.string()
});
export type Attachment = z.infer<typeof AttachmentSchema>;

// ---- SupplierEmailGroup - for email composition
export const SupplierEmailGroupSchema = z.object({
  supplier: SupplierSchema,
  extractionResults: z.array(z.unknown()), // ExtractionResult array
  defaultSubject: z.string(),
  defaultBody: z.string(),
  attachments: z.array(AttachmentSchema)
});
export type SupplierEmailGroup = z.infer<typeof SupplierEmailGroupSchema>;

// ---- MaterialCoverage - for aggregated recommendations
export const MaterialCoverageSchema = z.object({
  materialId: z.string(),
  materialName: z.string(),
  coveredBy: z.array(Uuid) // Supplier IDs
});
export type MaterialCoverage = z.infer<typeof MaterialCoverageSchema>;

// ---- AggregatedSupplierGroup - for supplier recommendations
export const AggregatedSupplierGroupSchema = z.object({
  suppliers: z.array(SupplierSchema),
  coverageScore: z.number(),
  reasoning: z.string(),
  materialCoverage: z.array(MaterialCoverageSchema)
});
export type AggregatedSupplierGroup = z.infer<
  typeof AggregatedSupplierGroupSchema
>;

// ---- PrepareSupplierEmailsRequest
export const PrepareSupplierEmailsRequestSchema = z.object({
  extractionJobId: Uuid,
  selectedMatchIds: z.array(Uuid)
});
export type PrepareSupplierEmailsRequest = z.infer<
  typeof PrepareSupplierEmailsRequestSchema
>;

// ---- PrepareSupplierEmailsResponse
export const PrepareSupplierEmailsResponseSchema = z.object({
  emailGroups: z.array(SupplierEmailGroupSchema)
});
export type PrepareSupplierEmailsResponse = z.infer<
  typeof PrepareSupplierEmailsResponseSchema
>;

// ---- SendSupplierEmailRequest
export const SendSupplierEmailRequestSchema = z.object({
  supplierId: Uuid,
  extractionResultIds: z.array(Uuid),
  subject: z.string().min(1),
  body: z.string().min(1),
  attachments: z.array(Uuid).optional() // File IDs
});
export type SendSupplierEmailRequest = z.infer<
  typeof SendSupplierEmailRequestSchema
>;

// ---- SendSupplierEmailResponse
export const SendSupplierEmailResponseSchema = z.object({
  success: z.boolean(),
  emailId: Uuid,
  sentAt: z.string()
});
export type SendSupplierEmailResponse = z.infer<
  typeof SendSupplierEmailResponseSchema
>;

// ---- ImportSuppliersRequest
export const ImportSuppliersRequestSchema = z.object({
  fileId: z.string() // S3 key path, not a UUID
});
export type ImportSuppliersRequest = z.infer<
  typeof ImportSuppliersRequestSchema
>;

// ---- ImportSuppliersResponse
export const ImportSuppliersResponseSchema = z.object({
  suppliers: z.array(SupplierSchema),
  extractionJobId: Uuid
});
export type ImportSuppliersResponse = z.infer<
  typeof ImportSuppliersResponseSchema
>;

// ---- MatchSuppliersRequest
export const MatchSuppliersRequestSchema = z.object({
  extractionJobId: Uuid,
  extractionResultIds: z.array(Uuid).optional()
});
export type MatchSuppliersRequest = z.infer<typeof MatchSuppliersRequestSchema>;

// ---- MatchSuppliersResponse
export const MatchSuppliersResponseSchema = z.object({
  matchJobId: Uuid,
  status: z.enum(["queued", "processing", "completed", "failed"])
});
export type MatchSuppliersResponse = z.infer<
  typeof MatchSuppliersResponseSchema
>;

// ---- GetMatchJobResponse
export const GetMatchJobResponseSchema = z.object({
  jobId: Uuid,
  status: z.enum(["queued", "processing", "completed", "failed"]),
  progress: z.number(),
  matches: z.array(SupplierMatchSchema),
  aggregatedRecommendations: AggregatedSupplierGroupSchema.optional()
});
export type GetMatchJobResponse = z.infer<typeof GetMatchJobResponseSchema>;

// ---- GetJobSupplierMatchesResponse
export const GetJobSupplierMatchesResponseSchema = z.object({
  matches: z.array(SupplierMatchSchema),
  aggregatedRecommendations: AggregatedSupplierGroupSchema
});
export type GetJobSupplierMatchesResponse = z.infer<
  typeof GetJobSupplierMatchesResponseSchema
>;

// ---- DeleteSupplierResponse
export const DeleteSupplierResponseSchema = z.object({
  success: z.boolean(),
  deletedMatchesCount: z.number()
});
export type DeleteSupplierResponse = z.infer<
  typeof DeleteSupplierResponseSchema
>;
