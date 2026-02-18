/**
 * Campaign entity for email campaigns
 */

export type CampaignStatus = "draft" | "sent";

export interface Campaign {
  /** Primary key - UUID */
  campaignId: string;
  /** Email subject line */
  subject: string;
  /** Raw HTML content */
  html: string;
  /** Campaign status */
  status: CampaignStatus;
  /** ISO8601 timestamp */
  createdAt: string;
  /** ISO8601 timestamp */
  updatedAt: string;
  /** ISO8601 timestamp - set when campaign is sent */
  sentAt?: string;
  /** Number of recipients when sent */
  sentCount?: number;
}

/**
 * DynamoDB key structure for Campaigns table
 */
export interface CampaignKey {
  campaignId: string;
}
