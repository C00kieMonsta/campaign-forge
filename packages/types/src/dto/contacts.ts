import { z } from "zod";
import type { Contact, ContactStatus, ContactSource } from "../entities/contact";

// ============================================================================
// Validation Schemas
// ============================================================================

export const emailSchema = z
  .string()
  .email("Invalid email format")
  .max(254, "Email too long");

export const contactStatusSchema = z.enum(["subscribed", "unsubscribed"]);
export const contactSourceSchema = z.enum(["landing", "import", "admin"]);

// ============================================================================
// Public API - Subscribe
// ============================================================================

export const subscribeRequestSchema = z.object({
  email: emailSchema,
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});

export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

export interface SubscribeResponse {
  ok: true;
  message: string;
}

export interface SubscribeErrorResponse {
  ok: false;
  error: string;
}

// ============================================================================
// Public API - Unsubscribe
// ============================================================================

export const unsubscribeQuerySchema = z.object({
  token: z.string().min(1, "Token required"),
});

export type UnsubscribeQuery = z.infer<typeof unsubscribeQuerySchema>;

export interface UnsubscribeResponse {
  ok: true;
  message: string;
}

export interface UnsubscribeErrorResponse {
  ok: false;
  error: string;
}

// ============================================================================
// Admin API - List Contacts
// ============================================================================

export const listContactsQuerySchema = z.object({
  status: contactStatusSchema.optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

export interface ListContactsResponse {
  items: Contact[];
  cursor: string | null;
  count: number;
}

// ============================================================================
// Admin API - Create Contact
// ============================================================================

const contactOptionalFieldsSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  displayName: z.string().max(200).optional(),
  email2: z.string().email().optional(),
  homePhone: z.string().max(50).optional(),
  businessPhone: z.string().max(50).optional(),
  mobilePhone: z.string().max(50).optional(),
  homeStreet: z.string().max(200).optional(),
  homeAddress2: z.string().max(200).optional(),
  homeCity: z.string().max(100).optional(),
  homePostalCode: z.string().max(20).optional(),
  homeCountry: z.string().max(100).optional(),
  businessAddress: z.string().max(200).optional(),
  businessAddress2: z.string().max(200).optional(),
  businessCity: z.string().max(100).optional(),
  businessState: z.string().max(100).optional(),
  businessPostalCode: z.string().max(20).optional(),
  businessCountry: z.string().max(100).optional(),
  organization: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  birthday: z.string().optional(),
  groups: z.array(z.string()).optional(),
});

export const createContactRequestSchema = contactOptionalFieldsSchema.extend({
  email: emailSchema,
  status: contactStatusSchema.default("subscribed"),
});

export type CreateContactRequest = z.infer<typeof createContactRequestSchema>;

export interface CreateContactResponse {
  ok: true;
  contact: Contact;
}

export interface CreateContactErrorResponse {
  ok: false;
  error: string;
}

// ============================================================================
// Admin API - Update Contact
// ============================================================================

export const updateContactRequestSchema = contactOptionalFieldsSchema.extend({
  status: contactStatusSchema.optional(),
});

export type UpdateContactRequest = z.infer<typeof updateContactRequestSchema>;

export interface UpdateContactResponse {
  ok: true;
  contact: Contact;
}

export interface UpdateContactErrorResponse {
  ok: false;
  error: string;
}

// ============================================================================
// Admin API - Import Contacts (CSV)
// ============================================================================

export interface ImportContactsResponse {
  ok: true;
  imported: number;
  skipped: number;
  errors: ImportContactError[];
}

export interface ImportContactError {
  row: number;
  email: string;
  reason: string;
}

export interface ImportContactsErrorResponse {
  ok: false;
  error: string;
}

// ============================================================================
// CSV Import Column Mapping
// ============================================================================

/**
 * Expected CSV columns for contact import:
 * - email (required): Email address
 * - firstName (optional): First name
 * - lastName (optional): Last name
 * - status (optional): Ignored on import (existing status preserved, new contacts default to subscribed)
 */
export interface ContactCSVRow {
  email: string;
  firstName?: string;
  lastName?: string;
  status?: string; // Ignored on import
}
