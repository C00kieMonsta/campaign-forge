// src/entities/suppliers.ts
import { z } from "zod";
import { Uuid } from "./primitives";

// ---- Supplier (entity schema) - matches Prisma output (camelCase)
export const SupplierSchema = z.object({
  id: Uuid,
  organizationId: Uuid,
  name: z.string(),
  contactName: z.string().nullable(),
  contactEmail: z.string(),
  contactPhone: z.string().nullable(),
  address: z.unknown().nullable(), // JsonValue from Prisma
  materialsOffered: z.unknown(), // JsonValue from Prisma (array)
  meta: z.unknown(), // JsonValue from Prisma
  createdAt: z.date(),
  updatedAt: z.date()
});
export type Supplier = z.infer<typeof SupplierSchema>;
