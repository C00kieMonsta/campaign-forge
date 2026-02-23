import { z } from "zod";
import type { Campaign, CampaignStatus } from "../entities/campaign";

// ============================================================================
// Validation Schemas
// ============================================================================

export const campaignStatusSchema = z.enum(["draft", "sent"]);

export const campaignAttachmentSchema = z.object({
  key: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
});

// ============================================================================
// Admin API - Create Campaign
// ============================================================================

export const createCampaignRequestSchema = z.object({
  name: z.string().min(1, "Name required").max(200, "Name too long"),
  subject: z.string().min(1, "Subject required").max(200, "Subject too long"),
  html: z.string().min(1, "HTML content required").max(500000, "HTML too large"),
  targetGroups: z.array(z.string()).optional(),
  attachments: z.array(campaignAttachmentSchema).optional(),
});

export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;

export interface CreateCampaignResponse {
  ok: true;
  campaign: Campaign;
}

export interface CreateCampaignErrorResponse {
  ok: false;
  error: string;
}

// ============================================================================
// Admin API - List Campaigns
// ============================================================================

export const listCampaignsQuerySchema = z.object({
  status: campaignStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;

/** Campaign without HTML content for list view */
export interface CampaignListItem {
  campaignId: string;
  subject: string;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  sentCount?: number;
}

export interface ListCampaignsResponse {
  items: CampaignListItem[];
  cursor: string | null;
  count: number;
}

// ============================================================================
// Admin API - Get Campaign
// ============================================================================

export interface GetCampaignResponse {
  ok: true;
  campaign: Campaign;
}

export interface GetCampaignErrorResponse {
  ok: false;
  error: string;
}

// ============================================================================
// Admin API - Update Campaign
// ============================================================================

export const updateCampaignRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(200).optional(),
  html: z.string().min(1).max(500000).optional(),
  targetGroups: z.array(z.string()).optional(),
  attachments: z.array(campaignAttachmentSchema).optional(),
});

export type UpdateCampaignRequest = z.infer<typeof updateCampaignRequestSchema>;

export interface UpdateCampaignResponse {
  ok: true;
  campaign: Campaign;
}

export interface UpdateCampaignErrorResponse {
  ok: false;
  error: string;
}

// ============================================================================
// Admin API - Send Test Email
// ============================================================================

export const sendTestRequestSchema = z.object({
  email: z.string().email("Invalid email"),
});

export type SendTestRequest = z.infer<typeof sendTestRequestSchema>;

export interface SendTestResponse {
  ok: true;
  message: string;
}

export interface SendTestErrorResponse {
  ok: false;
  error: string;
}

// ============================================================================
// Admin API - Send Campaign
// ============================================================================

export interface SendCampaignResponse {
  ok: true;
  sentCount: number;
  message: string;
}

export interface SendCampaignErrorResponse {
  ok: false;
  error: string;
}
