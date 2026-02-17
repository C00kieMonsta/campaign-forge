// src/entities/invitations.ts
import { z } from "zod";
import { Email, Uuid } from "./primitives";

// ---- Invitation (entity schema) - matches Prisma output (camelCase)
export const InvitationSchema = z.object({
  id: Uuid,
  organizationId: Uuid,
  email: Email,
  roleId: Uuid,
  invitedBy: Uuid,
  token: z.string(),
  status: z.enum(["pending", "accepted", "rejected", "expired"]),
  expiresAt: z.date(),
  acceptedAt: z.date().nullable(),
  acceptedBy: Uuid.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  // Include relations when fetched from API
  invitedByUser: z
    .object({
      id: Uuid,
      email: Email,
      firstName: z.string(),
      lastName: z.string()
    })
    .optional(),
  role: z
    .object({
      id: Uuid,
      name: z.string(),
      slug: z.string()
    })
    .optional(),
  organization: z
    .object({
      id: Uuid,
      name: z.string(),
      slug: z.string()
    })
    .optional()
});
export type Invitation = z.infer<typeof InvitationSchema>;
