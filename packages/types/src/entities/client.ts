// src/entities/client.ts
import { z } from "zod";
import { Uuid } from "./primitives";

// ---- Client (entity schema) - matches Prisma output (camelCase)
export const ClientSchema = z.object({
  id: Uuid,
  organizationId: Uuid,
  name: z.string(),
  description: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  address: z.unknown().nullable(), // JsonValue from Prisma
  meta: z.unknown(), // JsonValue from Prisma (required)
  createdAt: z.date(),
  updatedAt: z.date()
});
export type Client = z.infer<typeof ClientSchema>;
