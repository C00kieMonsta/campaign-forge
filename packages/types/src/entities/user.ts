// src/entities/users.ts
import { z } from "zod";
import { Email, Uuid } from "./primitives";

// ---- User (entity schema) - matches Prisma output (camelCase)
export const UserSchema = z.object({
  id: Uuid,
  email: Email,
  firstName: z.string(),
  lastName: z.string(),
  avatarUrl: z.string().nullable(),
  phone: z.string().nullable(),
  timezone: z.string(),
  meta: z.unknown(), // JsonValue from Prisma
  createdAt: z.date(),
  updatedAt: z.date()
});
export type User = z.infer<typeof UserSchema>;
