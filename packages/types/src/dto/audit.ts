// src/dto/audit.ts
import { z } from "zod";
import { AuditLog, AuditLogSchema } from "../entities/audit_log";
import { AuthenticatedUser } from "./auth";
import { Uuid } from "./primitives";

export interface AuditContext {
  user?: AuthenticatedUser;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
}

// ---- AuditLogFilters
export const AuditLogFiltersSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  actorEmail: z.string().optional(),
  targetTable: z.string().optional(),
  action: z.string().optional(),
  actorName: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional()
});
export type AuditLogFilters = z.infer<typeof AuditLogFiltersSchema>;

// ---- AuditLogsResponse
export const AuditLogsResponseSchema = z.object({
  organizationId: Uuid,
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  filters: AuditLogFiltersSchema,
  logs: z.array(AuditLogSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  hasMore: z.boolean()
});
export type AuditLogsResponse = z.infer<typeof AuditLogsResponseSchema>;
