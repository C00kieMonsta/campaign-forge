// src/dto/clients.ts
import { z } from "zod";
import { Client, ClientSchema } from "../entities/client";
import { Email, Uuid } from "./primitives";

// ---- Address schema
export const AddressSchema = z
  .object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional()
  })
  .optional();

// ---- CreateClientRequest
export const CreateClientRequestSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  contactName: z.string().max(100).optional(),
  contactEmail: Email.optional(),
  contactPhone: z.string().max(20).optional(),
  address: AddressSchema
});
export type CreateClientRequest = z.infer<typeof CreateClientRequestSchema>;

// ---- UpdateClientRequest
export const UpdateClientRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  contactName: z.string().max(100).optional(),
  contactEmail: Email.optional(),
  contactPhone: z.string().max(20).optional(),
  address: AddressSchema
});
export type UpdateClientRequest = z.infer<typeof UpdateClientRequestSchema>;

// ---- ClientListResponse
export const ClientListResponseSchema = z.object({
  clients: z.array(ClientSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number()
});
export type ClientListResponse = z.infer<typeof ClientListResponseSchema>;
