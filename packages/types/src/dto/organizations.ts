// src/dto/organizations.ts
import { z } from "zod";
import { Organization, OrganizationSchema } from "../entities/organization";
import {
  OrganizationMember,
  OrganizationMemberSchema
} from "../entities/organization_member";
import { Slug, Uuid } from "./primitives";

// ---- CreateOrganizationRequest
export const CreateOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(255),
  slug: Slug,
  description: z.string().max(1000).optional()
});
export type CreateOrganizationRequest = z.infer<
  typeof CreateOrganizationRequestSchema
>;

// ---- UpdateOrganizationRequest
export const UpdateOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: Slug.optional(),
  description: z.string().max(1000).optional()
});
export type UpdateOrganizationRequest = z.infer<
  typeof UpdateOrganizationRequestSchema
>;

// ---- OrganizationListResponse
export const OrganizationListResponseSchema = z.object({
  organizations: z.array(OrganizationSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number()
});
export type OrganizationListResponse = z.infer<
  typeof OrganizationListResponseSchema
>;

// ---- OrganizationMemberListResponse
export const OrganizationMemberListResponseSchema = z.object({
  users: z.array(OrganizationMemberSchema), // For compatibility with frontend expecting 'users' field
  total: z.number(),
  page: z.number(),
  limit: z.number()
});
export type OrganizationMemberListResponse = z.infer<
  typeof OrganizationMemberListResponseSchema
>;
