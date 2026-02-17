// src/dto/invitations.ts
import { z } from "zod";
import { InvitationSchema } from "../entities/invitation";
import { Email, Uuid } from "./primitives";

// ---- SendInvitationRequest
export const SendInvitationRequestSchema = z.object({
  email: Email,
  roleId: Uuid,
  message: z.string().max(500).optional()
});
export type SendInvitationRequest = z.infer<typeof SendInvitationRequestSchema>;

// ---- AcceptInvitationRequest
export const AcceptInvitationRequestSchema = z.object({
  token: z.string().min(1),
  userProfile: z
    .object({
      firstName: z.string().min(1).max(100),
      lastName: z.string().min(1).max(100),
      phone: z.string().max(20).optional()
    })
    .optional() // Only needed if user doesn't exist
});
export type AcceptInvitationRequest = z.infer<
  typeof AcceptInvitationRequestSchema
>;

// ---- ResendInvitationRequest
export const ResendInvitationRequestSchema = z.object({
  invitationId: Uuid
});
export type ResendInvitationRequest = z.infer<
  typeof ResendInvitationRequestSchema
>;

// ---- InvitationListResponse
export const InvitationListResponseSchema = z.object({
  invitations: z.array(InvitationSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number()
});
export type InvitationListResponse = z.infer<
  typeof InvitationListResponseSchema
>;

// ---- InvitationValidationResponse (for checking token validity)
export const InvitationValidationResponseSchema = z.object({
  valid: z.boolean(),
  invitation: InvitationSchema.optional(),
  error: z.string().optional()
});
export type InvitationValidationResponse = z.infer<
  typeof InvitationValidationResponseSchema
>;
