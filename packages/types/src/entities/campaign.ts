export type CampaignStatus = "draft" | "sending" | "sent";

export interface CampaignAttachment {
  key: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface Campaign {
  campaignId: string;
  name: string;
  subject: string;
  html: string;
  status: CampaignStatus;
  /** Group IDs to target, empty = all subscribed */
  targetGroups?: string[];
  attachments?: CampaignAttachment[];
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  sentCount?: number;
}

export interface CampaignKey {
  campaignId: string;
}
