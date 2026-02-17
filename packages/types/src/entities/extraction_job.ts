import { z } from "zod";
import { ExtractionJobDataLayerSchema } from "./extraction_job_data_layer";
import { Uuid } from "./primitives";

// Minimal schema shape for extraction job relations
const ExtractionSchemaMinimalSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number(),
  schemaIdentifier: z.string()
});

// ---- ExtractionJob (entity schema) - matches Prisma output (camelCase)
export const ExtractionJobSchema = z.object({
  id: Uuid,
  organizationId: Uuid,
  initiatedBy: Uuid,
  schemaId: Uuid,
  jobType: z.string(),
  status: z.string(),
  progressPercentage: z.number(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  errorMessage: z.string().nullable(),
  config: z.unknown(), // JsonValue from Prisma
  logs: z.unknown(), // JsonValue from Prisma (array)
  compiledJsonSchema: z.unknown(), // JsonValue from Prisma
  meta: z.unknown(), // JsonValue from Prisma
  createdAt: z.date(),
  updatedAt: z.date(),
  // Optional relations (included when fetched with include/select)
  schema: ExtractionSchemaMinimalSchema.optional(),
  extractionJobDataLayers: z.array(ExtractionJobDataLayerSchema).optional()
});
export type ExtractionJob = z.infer<typeof ExtractionJobSchema>;
