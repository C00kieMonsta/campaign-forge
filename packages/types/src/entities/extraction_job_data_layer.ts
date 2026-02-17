import { z } from "zod";
import { Uuid } from "./primitives";

// ---- ExtractionJobDataLayer (entity schema) - matches Prisma output (camelCase)
export const ExtractionJobDataLayerSchema = z.object({
  id: Uuid,
  extractionJobId: Uuid,
  dataLayerId: Uuid,
  processingOrder: z.number(),
  status: z.string(),
  createdAt: z.date()
});
export type ExtractionJobDataLayer = z.infer<
  typeof ExtractionJobDataLayerSchema
>;
