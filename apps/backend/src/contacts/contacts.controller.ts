import { Controller, Get, Post, Patch, Delete, Query, Param, Body, Res, BadRequestException, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../auth/admin.guard";
import { Response } from "express";
import {
  listContactsQuerySchema,
  createContactRequestSchema,
  updateContactRequestSchema,
  type Contact,
} from "@packages/types";
import { stringify as csvStringify } from "csv-stringify/sync";
import { ContactsService } from "./contacts.service";

@UseGuards(AdminGuard)
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
    const { status, ...rest } = parsed.data;
    const updates: Record<string, unknown> = { ...rest };
    if (status !== undefined) {
      updates.status = status;
      if (status === "unsubscribed") updates.unsubscribedAt = new Date().toISOString();
    }

    if (Object.keys(updates).length === 0) return { ok: true, contact: existing };
    await this.contacts.update(existing.emailLower, updates);
    return { ok: true, contact: { ...existing, ...updates, updatedAt: new Date().toISOString() } };
  }

  @Delete(":emailLower")
  async delete(@Param("emailLower") emailLower: string) {
    await this.contacts.getOrFail(decodeURIComponent(emailLower));
    await this.contacts.delete(decodeURIComponent(emailLower));
    return { ok: true };
  }

  @Post("import")
  async importContacts(@Body("contacts") contacts: (Partial<Contact> & { email: string })[]) {
    if (!Array.isArray(contacts) || contacts.length === 0) throw new BadRequestException("No contacts provided");

    const now = new Date().toISOString();
    const toImport: Contact[] = [];
    const errors: { row: number; email: string; reason: string }[] = [];

    for (let i = 0; i < contacts.length; i++) {
      const { email, ...rest } = contacts[i];
      if (!email || !email.includes("@")) {
        errors.push({ row: i + 1, email: email || "", reason: "Invalid email" });
        continue;
      }
      toImport.push({
        ...rest,
        emailLower: email.toLowerCase().trim(),
        email: email.trim(),
        status: "subscribed",
        source: "import",
        createdAt: now,
        updatedAt: now,
      } as Contact);
    }

    if (toImport.length > 0) await this.contacts.batchPut(toImport);

    console.log(JSON.stringify({ level: "info", action: "importContacts", imported: toImport.length, skipped: errors.length }));
    return { ok: true, imported: toImport.length, skipped: errors.length, errors };
  }
}
