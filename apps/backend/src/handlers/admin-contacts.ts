import {
  createContactRequestSchema,
  listContactsQuerySchema,
  updateContactRequestSchema,
  type Contact
} from "@packages/types";
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer as Event,
  APIGatewayProxyResultV2 as Result
} from "aws-lambda";
import { parse as csvParse } from "csv-parse/sync";
import { stringify as csvStringify } from "csv-stringify/sync";
import { isAllowedAdmin } from "../lib/auth";
import {
  badRequest,
  created,
  csvResponse,
  forbidden,
  notFound,
  ok,
  serverError
} from "../lib/http";
import * as contacts from "../models/contact";

export async function handler(event: Event): Promise<Result> {
  if (!isAllowedAdmin(event)) return forbidden();

  const { method } = event.requestContext.http;
  const path = event.rawPath;

  try {
    if (path === "/admin/contacts/export" && method === "GET")
      return exportContacts();
    if (path === "/admin/contacts/import" && method === "POST")
      return importContacts(event);
    if (path === "/admin/contacts" && method === "GET")
      return listContacts(event);
    if (path === "/admin/contacts" && method === "POST")
      return createContact(event);

    const match = path.match(/^\/admin\/contacts\/(.+)$/);
    if (match) {
      const emailLower = decodeURIComponent(match[1]);
      if (method === "GET") return getContact(emailLower);
      if (method === "PATCH") return updateContact(event, emailLower);
    }

    return notFound();
  } catch (err) {
    console.log(
      JSON.stringify({
        level: "error",
        handler: "admin-contacts",
        path,
        error: String(err)
      })
    );
    return serverError();
  }
}

async function listContacts(event: Event): Promise<Result> {
  const parsed = listContactsQuerySchema.safeParse(
    event.queryStringParameters || {}
  );
  if (!parsed.success)
    return badRequest(parsed.error.errors.map((e) => e.message).join(", "));

  const { status, q, limit, cursor } = parsed.data;
  if (status) return ok(await contacts.listByStatus(status, limit, cursor));
  if (q) return ok(await contacts.search(q, limit, cursor));
  return ok(await contacts.listAll(limit, cursor));
}

async function getContact(emailLower: string): Promise<Result> {
  const contact = await contacts.get(emailLower);
  if (!contact) return notFound("Contact not found");
  return ok({ ok: true, contact });
}

async function createContact(event: Event): Promise<Result> {
  const parsed = createContactRequestSchema.safeParse(
    JSON.parse(event.body || "{}")
  );
  if (!parsed.success)
    return badRequest(parsed.error.errors.map((e) => e.message).join(", "));

  const { email, firstName, lastName, status } = parsed.data;
  const now = new Date().toISOString();
  const contact: Contact = {
    emailLower: email.toLowerCase().trim(),
    email,
    firstName: firstName?.trim(),
    lastName: lastName?.trim(),
    status: status || "subscribed",
    source: "admin",
    createdAt: now,
    updatedAt: now
  };

  await contacts.put(contact);
  return created({ ok: true, contact });
}

async function updateContact(
  event: Event,
  emailLower: string
): Promise<Result> {
  const parsed = updateContactRequestSchema.safeParse(
    JSON.parse(event.body || "{}")
  );
  if (!parsed.success)
    return badRequest(parsed.error.errors.map((e) => e.message).join(", "));

  const existing = await contacts.get(emailLower);
  if (!existing) return notFound("Contact not found");

  const updates: Record<string, unknown> = {};
  if (parsed.data.firstName !== undefined)
    updates.firstName = parsed.data.firstName;
  if (parsed.data.lastName !== undefined)
    updates.lastName = parsed.data.lastName;
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status;
    if (parsed.data.status === "unsubscribed")
      updates.unsubscribedAt = new Date().toISOString();
  }

  if (Object.keys(updates).length === 0)
    return ok({ ok: true, contact: existing });

  await contacts.update(emailLower, updates);
  return ok({
    ok: true,
    contact: { ...existing, ...updates, updatedAt: new Date().toISOString() }
  });
}

async function importContacts(event: Event): Promise<Result> {
  if (!event.body) return badRequest("CSV body required");

  const rows = csvParse(event.body, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[];
  const now = new Date().toISOString();
  const toImport: Contact[] = [];
  const errors: { row: number; email: string; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = row.email?.trim();
    if (!email || !email.includes("@")) {
      errors.push({ row: i + 1, email: email || "", reason: "Invalid email" });
      continue;
    }
    toImport.push({
      emailLower: email.toLowerCase(),
      email,
      firstName: row.firstName?.trim() || undefined,
      lastName: row.lastName?.trim() || undefined,
      status: "subscribed",
      source: "import",
      createdAt: now,
      updatedAt: now
    });
  }

  if (toImport.length > 0) await contacts.batchPut(toImport);

  console.log(
    JSON.stringify({
      level: "info",
      action: "importContacts",
      imported: toImport.length,
      skipped: errors.length
    })
  );
  return ok({
    ok: true,
    imported: toImport.length,
    skipped: errors.length,
    errors
  });
}

async function exportContacts(): Promise<Result> {
  const all = await contacts.scanAll();
  const csv = csvStringify(
    all.map((c) => ({
      email: c.email,
      firstName: c.firstName || "",
      lastName: c.lastName || "",
      status: c.status,
      createdAt: c.createdAt
    })),
    { header: true }
  );
  return csvResponse(
    csv,
    `contacts-${new Date().toISOString().split("T")[0]}.csv`
  );
}
