import {
  createCampaignRequestSchema,
  listCampaignsQuerySchema,
  sendTestRequestSchema,
  updateCampaignRequestSchema,
  type Campaign,
  type CampaignListItem
} from "@packages/types";
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer as Event,
  APIGatewayProxyResultV2 as Result
} from "aws-lambda";
import { isAllowedAdmin } from "../lib/auth";
import { appendFooter } from "../lib/footer";
import {
  badRequest,
  created,
  forbidden,
  notFound,
  ok,
  serverError
} from "../lib/http";
import { sendBatch, sendEmail } from "../lib/ses";
import * as campaigns from "../models/campaign";
import * as contacts from "../models/contact";

export async function handler(event: Event): Promise<Result> {
  if (!isAllowedAdmin(event)) return forbidden();

  const { method } = event.requestContext.http;
  const path = event.rawPath;

  try {
    if (path === "/admin/campaigns" && method === "POST")
      return createCampaign(event);
    if (path === "/admin/campaigns" && method === "GET")
      return listCampaigns(event);

    const match = path.match(/^\/admin\/campaigns\/([^/]+)(\/(.+))?$/);
    if (match) {
      const id = match[1];
      const action = match[3];

      if (!action && method === "GET") return getCampaign(id);
      if (!action && method === "PATCH") return updateCampaign(event, id);
      if (action === "test" && method === "POST")
        return testCampaign(event, id);
      if (action === "send" && method === "POST") return sendCampaign(id);
    }

    return notFound();
  } catch (err) {
    console.log(
      JSON.stringify({
        level: "error",
        handler: "admin-campaigns",
        path,
        error: String(err)
      })
    );
    return serverError();
  }
}

async function createCampaign(event: Event): Promise<Result> {
  const parsed = createCampaignRequestSchema.safeParse(
    JSON.parse(event.body || "{}")
  );
  if (!parsed.success)
    return badRequest(parsed.error.errors.map((e) => e.message).join(", "));

  const now = new Date().toISOString();
  const campaign: Campaign = {
    campaignId: crypto.randomUUID(),
    subject: parsed.data.subject,
    html: parsed.data.html,
    status: "draft",
    createdAt: now,
    updatedAt: now
  };

  await campaigns.put(campaign);
  return created({ ok: true, campaign });
}

async function listCampaigns(event: Event): Promise<Result> {
  const parsed = listCampaignsQuerySchema.safeParse(
    event.queryStringParameters || {}
  );
  if (!parsed.success)
    return badRequest(parsed.error.errors.map((e) => e.message).join(", "));

  const result = await campaigns.list(parsed.data.limit, parsed.data.cursor);

  // Strip html from list view
  const items: CampaignListItem[] = result.items.map(
    ({ html: _, ...rest }) => rest
  );
  return ok({ items, cursor: result.cursor, count: result.count });
}

async function getCampaign(id: string): Promise<Result> {
  const campaign = await campaigns.get(id);
  if (!campaign) return notFound("Campaign not found");
  return ok({ ok: true, campaign });
}

async function updateCampaign(event: Event, id: string): Promise<Result> {
  const parsed = updateCampaignRequestSchema.safeParse(
    JSON.parse(event.body || "{}")
  );
  if (!parsed.success)
    return badRequest(parsed.error.errors.map((e) => e.message).join(", "));

  const existing = await campaigns.get(id);
  if (!existing) return notFound("Campaign not found");
  if (existing.status === "sent")
    return badRequest("Cannot edit a sent campaign");

  const updates: Record<string, unknown> = {};
  if (parsed.data.subject !== undefined) updates.subject = parsed.data.subject;
  if (parsed.data.html !== undefined) updates.html = parsed.data.html;

  if (Object.keys(updates).length === 0)
    return ok({ ok: true, campaign: existing });

  await campaigns.update(id, updates);
  return ok({
    ok: true,
    campaign: { ...existing, ...updates, updatedAt: new Date().toISOString() }
  });
}

async function testCampaign(event: Event, id: string): Promise<Result> {
  const parsed = sendTestRequestSchema.safeParse(
    JSON.parse(event.body || "{}")
  );
  if (!parsed.success)
    return badRequest(parsed.error.errors.map((e) => e.message).join(", "));

  const campaign = await campaigns.get(id);
  if (!campaign) return notFound("Campaign not found");

  const html = appendFooter(campaign.html, parsed.data.email.toLowerCase());
  await sendEmail(parsed.data.email, `[TEST] ${campaign.subject}`, html);

  return ok({ ok: true, message: `Test sent to ${parsed.data.email}` });
}

async function sendCampaign(id: string): Promise<Result> {
  const campaign = await campaigns.get(id);
  if (!campaign) return notFound("Campaign not found");
  if (campaign.status === "sent") return badRequest("Campaign already sent");

  const subscribed = await contacts.queryAllSubscribed();
  if (subscribed.length === 0) return badRequest("No subscribed contacts");

  const emails = subscribed.map((c) => ({
    to: c.email,
    subject: campaign.subject,
    html: appendFooter(campaign.html, c.emailLower)
  }));

  const { sent, failed } = await sendBatch(emails);

  await campaigns.update(id, {
    status: "sent",
    sentAt: new Date().toISOString(),
    sentCount: sent
  });

  console.log(
    JSON.stringify({
      level: "info",
      action: "campaignSent",
      campaignId: id,
      sent,
      failed
    })
  );
  return ok({ ok: true, sentCount: sent, message: `Sent to ${sent} contacts` });
}
