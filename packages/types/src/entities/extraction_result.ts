import { z } from "zod";
import { Uuid } from "./primitives";

// ---- ExtractionResult (entity schema) - matches Prisma output (camelCase)
export const ExtractionResultSchema = z.object({
  id: Uuid,
  extractionJobId: Uuid,
  rawExtraction: z.record(z.any()), // JsonValue from Prisma
  validationErrors: z.unknown().nullable(), // JsonValue from Prisma
  evidence: z.object({
    sourceText: z.string().nullable(),
    pageNumber: z.number().nullable(),
    location: z.string().nullable()
  }),
  verifiedData: z.record(z.any()).nullable(), // JsonValue from Prisma
  agentExecutionMetadata: z.unknown(), // JsonValue from Prisma (array)
  status: z.enum(["pending", "accepted", "rejected", "edited"]),
  confidenceScore: z.number().nullable(),
  pageNumber: z.number().nullable(),
  verifiedBy: Uuid.nullable(),
  verifiedAt: z.date().nullable(),
  verificationNotes: z.string().nullable(),
  editedBy: Uuid.nullable(),
  editedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
