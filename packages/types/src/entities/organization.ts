// src/entities/organization.ts
import { z } from "zod";
import { Slug, Uuid } from "./primitives";

// ---- Organization (entity schema) - matches Prisma output (camelCase)
export const OrganizationSchema = z.object({
  id: Uuid,
  name: z.string(),
  slug: Slug,
  description: z.string().nullable(),
  meta: z.unknown(), // JsonValue from Prisma
  createdAt: z.date(),
  updatedAt: z.date()
});
export type Organization = z.infer<typeof OrganizationSchema>;
