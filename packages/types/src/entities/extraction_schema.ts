// src/entities/extraction_schema.ts
import { z } from "zod";
import { Uuid } from "./primitives";

// ---- ExtractionSchema (entity schema) - matches Prisma output (camelCase)
export const ExtractionSchemaSchema = z.object({
  id: Uuid,
  organizationId: Uuid,
  schemaIdentifier: z.string(),
  name: z.string(),
  version: z.number(),
  definition: z.unknown(), // JsonValue from Prisma
  compiledJsonSchema: z.unknown(), // JsonValue from Prisma
  prompt: z.string().nullable(),
  examples: z.unknown().nullable(), // JsonValue from Prisma
  agents: z.unknown(), // JsonValue from Prisma (array)
  changeDescription: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
export type ExtractionSchema = z.infer<typeof ExtractionSchemaSchema>;
