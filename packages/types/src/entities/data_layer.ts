import { z } from "zod";
import { Uuid } from "./primitives";

// ---- DataLayer (entity schema) - matches Prisma output (camelCase)
export const DataLayerSchema = z.object({
  id: Uuid,
  organizationId: Uuid,
  projectId: Uuid,
  name: z.string(),
  description: z.string().nullable(),
  fileType: z.string(),
  filePath: z.string(),
  fileSize: z.bigint().nullable(),
  fileHash: z.string().nullable(),
  sourceType: z.string(),
  sourceMetadata: z.unknown(), // JsonValue from Prisma
  processingStatus: z.string(),
  processingError: z.string().nullable(),
  processedAt: z.date().nullable(),
  parentId: Uuid.nullable(),
  meta: z.unknown(), // JsonValue from Prisma
  createdAt: z.date(),
  updatedAt: z.date(),
  // Recursive children for zip files with extracted contents
  children: z.array(z.lazy(() => z.any())).optional()
});

export type DataLayer = z.infer<typeof DataLayerSchema>;
