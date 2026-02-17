import { z } from "zod";
import { Uuid } from "./primitives";

// ---- SupplierMatch (entity schema) - matches Prisma output (camelCase)
export const SupplierMatchSchema = z.object({
  id: Uuid,
  extractionResultId: Uuid,
  supplierId: Uuid,
  confidenceScore: z.number().nullable(),
  matchReason: z.string().nullable(),
  matchMetadata: z.unknown(), // JsonValue from Prisma
  isSelected: z.boolean(),
  selectedBy: Uuid.nullable(),
  selectedAt: z.date().nullable(),
  emailSent: z.boolean(),
  emailSentAt: z.date().nullable(),
  meta: z.unknown(), // JsonValue from Prisma
  createdAt: z.date(),
  updatedAt: z.date()
});
export type SupplierMatch = z.infer<typeof SupplierMatchSchema>;
