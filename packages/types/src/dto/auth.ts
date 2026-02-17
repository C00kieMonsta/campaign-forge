// src/dto/auth.ts
import { z } from "zod";
import { IsoDateString, Uuid } from "./primitives";

// ---- JwtPayload
export const JwtPayloadSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  role: z.string(), // or z.enum(["owner","admin","member","viewer"])
  aud: z.string(),
  exp: z.number(),
  iat: z.number(),
  iss: z.string()
});
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

// ---- AuthenticatedUser
export const AuthenticatedUserSchema = z.object({
  id: Uuid.or(z.string()), // relax if you don't use UUIDs yet
  email: z.string().email(),
  role: z.string(), // or z.enum([...]) if you have fixed roles
  organizationId: Uuid.optional() // User's current organization
});
export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;

// ---- LoginRequest
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// ---- RegisterRequest
export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  invitationToken: z.string().optional() // Optional invitation token for accepting invitations
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

// ---- AuthResponse
export const AuthResponseSchema = z.object({
  user: AuthenticatedUserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: IsoDateString // ISO timestamp string
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ---- RefreshTokenRequest
export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1)
});
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

// ---- ProtectedDataResponse
export const ProtectedDataResponseSchema = z.object({
  message: z.string(),
  user: AuthenticatedUserSchema,
  timestamp: IsoDateString
});
export type ProtectedDataResponse = z.infer<typeof ProtectedDataResponseSchema>;

// ---- AdminAccessResponse
export const AdminAccessResponseSchema = z.object({
  hasAdminAccess: z.boolean(),
  role: z
    .object({
      slug: z.string(),
      name: z.string(),
      isSystem: z.boolean()
    })
    .optional(),
  organizationId: z.string().optional()
});
export type AdminAccessResponse = z.infer<typeof AdminAccessResponseSchema>;
