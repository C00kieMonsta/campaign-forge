import { z } from "zod";
import { Uuid } from "./primitives";

// ---- OrganizationMember (entity schema) - matches Prisma output (camelCase)
export const OrganizationMemberSchema = z.object({
  id: Uuid,
  organizationId: Uuid,
  userId: Uuid,
  roleId: Uuid,
  status: z.string(),
  joinedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
  // Include user and role relations when fetched from API
  user: z
    .object({
      id: z.string(),
      email: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      phone: z.string().nullable(),
      timezone: z.string(),
      avatarUrl: z.string().nullable(),
      createdAt: z.date(),
      updatedAt: z.date()
    })
    .optional(),
  role: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string()
    })
    .optional()
});
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;
