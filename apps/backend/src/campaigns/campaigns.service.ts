import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import type { Campaign } from "@packages/types";
import { DdbService } from "../shared/ddb.service";

@Injectable()
export class CampaignsService {
  private get table() { return this.ddb.tables.campaigns; }

  constructor(private ddb: DdbService) {}

  async get(id: string): Promise<Campaign | null> {
    return this.ddb.get(this.table, { campaignId: id }) as Promise<Campaign | null>;
  }

  async getOrFail(id: string): Promise<Campaign> {
    const c = await this.get(id);
    if (!c) throw new NotFoundException("Campaign not found");
    return c;
  }

  async create(data: { name: string; subject: string; html: string; targetGroups?: string[] }): Promise<Campaign> {
    const now = new Date().toISOString();
    const campaign: Campaign = {
      campaignId: crypto.randomUUID(),
      name: data.name,
      subject: data.subject,
      html: data.html,
      status: "draft",
      targetGroups: data.targetGroups,
      createdAt: now,
      updatedAt: now,
    };
    await this.ddb.put(this.table, campaign as unknown as Record<string, unknown>);
    return campaign;
  }

  async update(id: string, fields: Record<string, unknown>): Promise<void> {
    await this.ddb.update(this.table, { campaignId: id }, { ...fields, updatedAt: new Date().toISOString() });
  }

  async list(limit: number, cursor?: string) {
    const result = await this.ddb.scan(this.table, { limit, cursor });
    return { ...result, count: result.items.length };
  }

  async delete(id: string): Promise<void> {
    await this.ddb.delete(this.table, { campaignId: id });
  }

  async markSending(id: string): Promise<void> {
    await this.update(id, { status: "sending" });
  }

  async markSent(id: string, sentCount: number): Promise<void> {
    await this.update(id, { status: "sent", sentAt: new Date().toISOString(), sentCount });
  }
}
