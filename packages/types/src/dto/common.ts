import { z } from "zod";

export const PaginationRequestSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});
export type PaginationRequest = z.infer<typeof PaginationRequestSchema>;
