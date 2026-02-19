import { Controller, Get, Post, Patch, Query, Param, Body, Res, BadRequestException } from "@nestjs/common";
import { Response } from "express";
import {
  listContactsQuerySchema,
  createContactRequestSchema,
  updateContactRequestSchema,
  type Contact,
} from "@packages/types";
import { parse as csvParse } from "csv-parse/sync";
import { stringify as csvStringify } from "csv-stringify/sync";
import { ContactsService } from "./contacts.service";

@Controller("admin/contacts")
export class ContactsController {
  constructor(private contacts: ContactsService) {}

  @Get()
  async list(@Query() query: Record<string, string>) {
    const parsed = listContactsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.errors.map((e) => e.message).join(", "));
    return this.contacts.list(parsed.data);
  }

  @Get("export")
  async exportCsv(@Res() res: Response) {
    const all = await this.contacts.scanAll();
    const csv = csvStringify(
      all.map((c) => ({ email: c.email, firstName: c.firstName || "", lastName: c.lastName || "", status: c.status, createdAt: c.createdAt })),
      { header: true },
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="contacts-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  }

  @Get(":emailLower")
  async get(@Param("emailLower") emailLower: string) {
    const contact = await this.contacts.getOrFail(decodeURIComponent(emailLower));
    return { ok: true, contact };
  }

  @Post()
  async create(@Body() body: unknown) {
    const parsed = createContactRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.errors.map((e) => e.message).join(", "));
    const contact = await this.contacts.create(parsed.data);
    return { ok: true, contact };
  }

  @Patch(":emailLower")
  async update(@Param("emailLower") emailLower: string, @Body() body: unknown) {
    const parsed = updateContactRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.errors.map((e) => e.message).join(", "));

    const existing = await this.contacts.getOrFail(decodeURIComponent(emailLower));
    const updates: Record<string, unknown> = {};
    if (parsed.data.firstName !== undefined) updates.firstName = parsed.data.firstName;
    if (parsed.data.lastName !== undefined) updates.lastName = parsed.data.lastName;
    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status;
      if (parsed.data.status === "unsubscribed") updates.unsubscribedAt = new Date().toISOString();
    }

    if (Object.keys(updates).length === 0) return { ok: true, contact: existing };
    await this.contacts.update(existing.emailLower, updates);
    return { ok: true, contact: { ...existing, ...updates, updatedAt: new Date().toISOString() } };
  }

  @Post("import")
  async importCsv(@Body() body: string) {
    if (!body) throw new BadRequestException("CSV body required");

    const rows = csvParse(body, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
    const now = new Date().toISOString();
    const toImport: Contact[] = [];
    const errors: { row: number; email: string; reason: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const email = rows[i].email?.trim();
      if (!email || !email.includes("@")) {
        errors.push({ row: i + 1, email: email || "", reason: "Invalid email" });
        continue;
      }
      toImport.push({
        emailLower: email.toLowerCase(),
        email,
        firstName: rows[i].firstName?.trim() || undefined,
        lastName: rows[i].lastName?.trim() || undefined,
        status: "subscribed",
        source: "import",
        createdAt: now,
        updatedAt: now,
      });
    }

    if (toImport.length > 0) await this.contacts.batchPut(toImport);

    console.log(JSON.stringify({ level: "info", action: "importContacts", imported: toImport.length, skipped: errors.length }));
    return { ok: true, imported: toImport.length, skipped: errors.length, errors };
  }
}
