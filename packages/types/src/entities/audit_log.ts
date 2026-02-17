// src/entities/audit_log.ts
import { z } from "zod";
import { Uuid } from "./primitives";

// ---- AuditLog (entity schema) - matches Prisma output (camelCase)
export const AuditLogSchema = z.object({
  id: Uuid,
  occurredAt: z.string(),
  actorUserId: Uuid.nullable(),
  actorOrgId: Uuid.nullable(),
  actorEmail: z.string().nullable(),
  targetTable: z.string(),
  targetId: z.string().nullable(),
  action: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  correlationId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  actorDisplayName: z.string(),
  formattedDate: z.string()
});
export type AuditLog = z.infer<typeof AuditLogSchema>;
