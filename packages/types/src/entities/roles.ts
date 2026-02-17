// src/entities/roles.ts
import { z } from "zod";
import { Uuid } from "./primitives";

// ---- Role (entity schema) - matches Prisma output (camelCase)
export const RoleSchema = z.object({
  id: Uuid,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  organizationId: Uuid.nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
export type Role = z.infer<typeof RoleSchema>;
