import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { subscribeRequestSchema, unsubscribeQuerySchema, type Contact } from "@packages/types";
import * as contacts from "../models/contact";
import { verify as verifyToken } from "../lib/token";
import { ok, badRequest, notFound, serverError, htmlResponse } from "../lib/http";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const { method } = event.requestContext.http;
  const path = event.rawPath;

  try {
    if (method === "POST" && path === "/public/subscribe") return subscribe(event);
    if (method === "GET" && path === "/public/unsubscribe") return unsubscribe(event);
    return notFound();
  } catch (err) {
    console.log(JSON.stringify({ level: "error", handler: "public", path, error: String(err) }));
    return serverError();
  }
}

async function subscribe(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const parsed = subscribeRequestSchema.safeParse(JSON.parse(event.body || "{}"));
  if (!parsed.success) return badRequest(parsed.error.errors.map(e => e.message).join(", "));

  const { email, firstName, lastName } = parsed.data;
  const emailLower = email.toLowerCase().trim();

  const existing = await contacts.get(emailLower);
  if (existing) {
    return ok({ ok: true, message: existing.status === "subscribed" ? "Already subscribed" : "Contact exists" });
  }

  const now = new Date().toISOString();
  const contact: Contact = {
    emailLower, email,
    firstName: firstName?.trim(),
    lastName: lastName?.trim(),
    status: "subscribed", source: "landing",
    createdAt: now, updatedAt: now,
  };

  try {
    await contacts.create(contact);
  } catch (err) {
    if ((err as Error).name === "ConditionalCheckFailedException") {
      return ok({ ok: true, message: "Already subscribed" });
    }
    throw err;
  }

  console.log(JSON.stringify({ level: "info", action: "subscribed", emailLower }));
  return ok({ ok: true, message: "Subscribed" });
}

async function unsubscribe(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const parsed = unsubscribeQuerySchema.safeParse(event.queryStringParameters || {});
  if (!parsed.success) return htmlResponse(400, errorPage("Invalid or missing token."));

  const result = verifyToken(parsed.data.token);
  if (!result.valid) {
    const msg = result.error === "expired" ? "This link has expired." : "Invalid link.";
    return htmlResponse(400, errorPage(msg));
  }

  try {
    await contacts.update(result.emailLower, { status: "unsubscribed", unsubscribedAt: new Date().toISOString() });
    console.log(JSON.stringify({ level: "info", action: "unsubscribed", emailLower: result.emailLower }));
  } catch {
    // Contact doesn't exist — show success anyway (idempotent)
  }

  return htmlResponse(200, successPage());
}

function successPage(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.c{text-align:center;padding:40px;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);max-width:400px}</style></head>
<body><div class="c"><div style="font-size:48px">✓</div><h1>Unsubscribed</h1><p>You've been removed from our mailing list.</p></div></body></html>`;
}

function errorPage(msg: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Error</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.c{text-align:center;padding:40px;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);max-width:400px}h1{color:#d32f2f}</style></head>
<body><div class="c"><h1>Error</h1><p>${msg}</p></div></body></html>`;
}
