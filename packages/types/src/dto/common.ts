// src/dto/common.ts
import { z } from "zod";

// ---- Common API patterns ----

// ---- PaginationRequest
export const PaginationRequestSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20)
});
export type PaginationRequest = z.infer<typeof PaginationRequestSchema>;

// ---- ApiError
export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
  timestamp: z.date(),
  path: z.string().optional(),
  details: z.record(z.any()).optional()
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---- ApiSuccess
export const ApiSuccessSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  timestamp: z.string().datetime()
});
export type ApiSuccess = z.infer<typeof ApiSuccessSchema>;
