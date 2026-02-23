import { Controller, Get, Post, Patch, Delete, Query, Param, Body, BadRequestException, UseGuards, UseInterceptors, UploadedFile } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AdminGuard } from "../auth/admin.guard";
import { z } from "zod";
import {
  createCampaignRequestSchema,
  listCampaignsQuerySchema,
  sendTestRequestSchema,
  updateCampaignRequestSchema,
  type CampaignListItem,
} from "@packages/types";

const directTestSendSchema = z.object({
  email: z.string().email("Invalid email"),
  subject: z.string().min(1),
  html: z.string().min(1),
});
import type { Contact } from "@packages/types";
import type { CampaignAttachment } from "@packages/types";
import { CampaignsService } from "./campaigns.service";
import { ContactsService } from "../contacts/contacts.service";
import { S3Service } from "../shared/s3.service";
import { SesService, type EmailAttachment } from "../shared/ses.service";
import { TokenService } from "../shared/token.service";

function replaceTemplateVars(html: string, contact: Pick<Contact, "firstName" | "lastName" | "email" | "displayName" | "organization">): string {
  return html
    .replace(/\{\{firstName\}\}/gi, contact.firstName ?? "")
    .replace(/\{\{lastName\}\}/gi, contact.lastName ?? "")
    .replace(/\{\{email\}\}/gi, contact.email)
    .replace(/\{\{displayName\}\}/gi, contact.displayName ?? "")
    .replace(/\{\{organization\}\}/gi, contact.organization ?? "");
}

const SAMPLE_CONTACT = {
  firstName: "Marie",
  lastName: "Dupont",
  email: "marie.dupont@example.com",
  displayName: "Marie Dupont",
  organization: "Acme Corp",
};

@UseGuards(AdminGuard)
@Controller("admin/campaigns")
export class CampaignsController {
  constructor(
    private campaigns: CampaignsService,
    private contacts: ContactsService,
    private s3: S3Service,
    private ses: SesService,
    private token: TokenService,
  ) {}

  private async fetchAttachments(meta: CampaignAttachment[]): Promise<EmailAttachment[]> {
    if (meta.length === 0) return [];
    return Promise.all(
      meta.map(async (a) => {
        const { body } = await this.s3.get(a.key);
        return { filename: a.filename, content: body, contentType: a.contentType };
      }),
    );
  }

  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file provided");

    const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "bin";
    const key = `${crypto.randomUUID()}.${ext}`;

    await this.s3.upload(key, file.buffer, file.mimetype);

    return {
      ok: true,
      key,
      url: this.s3.publicUrl(key),
      filename: file.originalname,
      contentType: file.mimetype,
      size: file.size,
    };
  }

  @Get()
  async list(@Query() query: Record<string, string>) {
    const parsed = listCampaignsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.errors.map((e) => e.message).join(", "));

    const result = await this.campaigns.list(parsed.data.limit, parsed.data.cursor);
    return { items: result.items as CampaignListItem[], cursor: result.cursor, count: result.count };
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const campaign = await this.campaigns.getOrFail(id);
    return { ok: true, campaign };
  }

  @Post()
  async create(@Body() body: unknown) {
    const parsed = createCampaignRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.errors.map((e) => e.message).join(", "));
    const campaign = await this.campaigns.create(parsed.data);
    return { ok: true, campaign };
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const parsed = updateCampaignRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.errors.map((e) => e.message).join(", "));

    const existing = await this.campaigns.getOrFail(id);
    if (existing.status === "sent") throw new BadRequestException("Cannot edit a sent campaign");

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.subject !== undefined) updates.subject = parsed.data.subject;
    if (parsed.data.html !== undefined) updates.html = parsed.data.html;
    if (parsed.data.targetGroups !== undefined) updates.targetGroups = parsed.data.targetGroups;
    if (parsed.data.attachments !== undefined) updates.attachments = parsed.data.attachments;

    if (Object.keys(updates).length === 0) return { ok: true, campaign: existing };
    await this.campaigns.update(id, updates);
    return { ok: true, campaign: { ...existing, ...updates, updatedAt: new Date().toISOString() } };
  }

  @Delete(":id")
  async delete(@Param("id") id: string) {
    await this.campaigns.getOrFail(id);
    await this.campaigns.delete(id);
    return { ok: true };
  }

  @Post("test-send")
  async testSendDirect(@Body() body: unknown) {
    const parsed = directTestSendSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.errors.map((e) => e.message).join(", "));

    const html = this.token.appendFooter(replaceTemplateVars(parsed.data.html, SAMPLE_CONTACT), parsed.data.email.toLowerCase());
    await this.ses.send(parsed.data.email, `[TEST] ${parsed.data.subject}`, html);
    return { ok: true, message: `Test sent to ${parsed.data.email}` };
  }

  @Post(":id/test")
  async testSend(@Param("id") id: string, @Body() body: unknown) {
    const parsed = sendTestRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.errors.map((e) => e.message).join(", "));

    const campaign = await this.campaigns.getOrFail(id);
    const html = this.token.appendFooter(replaceTemplateVars(campaign.html, SAMPLE_CONTACT), parsed.data.email.toLowerCase());

    const attachmentBuffers = await this.fetchAttachments(campaign.attachments ?? []);
    await this.ses.sendWithAttachments(parsed.data.email, `[TEST] ${campaign.subject}`, html, attachmentBuffers);
    return { ok: true, message: `Test sent to ${parsed.data.email}` };
  }

  @Post(":id/send")
  async sendCampaign(@Param("id") id: string) {
    const campaign = await this.campaigns.getOrFail(id);
    if (campaign.status === "sent") throw new BadRequestException("Campaign already sent");
    if (campaign.status === "sending") throw new BadRequestException("Campaign is already being sent");

    const subscribed = await this.contacts.queryAllSubscribed();

    const targetGroups = campaign.targetGroups ?? [];
    const recipients =
      targetGroups.length > 0
        ? subscribed.filter((c) => c.groups?.some((g) => targetGroups.includes(g)))
        : subscribed;

    if (recipients.length === 0) throw new BadRequestException("No subscribed contacts in target groups");

    await this.campaigns.markSending(id);

    const emails = recipients.map((c) => ({
      to: c.email,
      subject: campaign.subject,
      html: this.token.appendFooter(replaceTemplateVars(campaign.html, c), c.emailLower),
    }));

    const attachmentMeta = campaign.attachments ?? [];

    setImmediate(async () => {
      try {
        const attachmentBuffers = await this.fetchAttachments(attachmentMeta);
        console.log(JSON.stringify({ level: "info", action: "campaignSendStart", campaignId: id, recipients: emails.length, attachments: attachmentBuffers.length }));

        const { sent, failed } = await this.ses.sendBatch(emails, attachmentBuffers);
        await this.campaigns.markSent(id, sent);
        console.log(JSON.stringify({ level: "info", action: "campaignSent", campaignId: id, sent, failed }));
      } catch (err) {
        console.log(JSON.stringify({ level: "error", action: "campaignSendFailed", campaignId: id, error: String(err) }));
      }
    });

    return { ok: true, queued: true, recipientCount: recipients.length };
  }
}
