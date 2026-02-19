export type CampaignStatus = "draft" | "sent";

export interface Campaign {
  campaignId: string;
  name: string;
  subject: string;
  html: string;
  status: CampaignStatus;
  /** Group IDs to target, empty = all subscribed */
  targetGroups?: string[];
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  sentCount?: number;
}

export interface CampaignKey {
  campaignId: string;
}
