// src/dto/users.ts
import { z } from "zod";
import { Email, Uuid } from "./primitives";

// ---- CreateUserProfileRequest
export const CreateUserProfileRequestSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(20).optional()
});
export type CreateUserProfileRequest = z.infer<
  typeof CreateUserProfileRequestSchema
>;

// ---- UpdateUserProfileRequest
export const UpdateUserProfileRequestSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  timezone: z.string().optional(),
  avatarUrl: z.string().url().optional()
});
export type UpdateUserProfileRequest = z.infer<
  typeof UpdateUserProfileRequestSchema
>;

// ---- UserProfile (API response)
export const UserProfileSchema = z.object({
  id: Uuid,
  email: Email,
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  timezone: z.string(),
  avatarUrl: z.string().url().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

// ---- UserListResponse
export const UserListResponseSchema = z.object({
  users: z.array(UserProfileSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number()
});
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
