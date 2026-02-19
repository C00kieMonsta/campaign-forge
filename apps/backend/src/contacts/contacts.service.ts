import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import type { Contact } from "@packages/types";
import { DdbService } from "../shared/ddb.service";

@Injectable()
export class ContactsService {
  private get table() { return this.ddb.tables.contacts; }

  constructor(private ddb: DdbService) {}

  async get(emailLower: string): Promise<Contact | null> {
    return this.ddb.get(this.table, { emailLower }) as Promise<Contact | null>;
  }

  async getOrFail(emailLower: string): Promise<Contact> {
    const c = await this.get(emailLower);
    if (!c) throw new NotFoundException("Contact not found");
    return c;
  }

  async create(data: { email: string; firstName?: string; lastName?: string; status?: string; source?: string }): Promise<Contact> {
    const now = new Date().toISOString();
    const contact: Contact = {
      emailLower: data.email.toLowerCase().trim(),
      email: data.email,
      firstName: data.firstName?.trim(),
      lastName: data.lastName?.trim(),
      status: (data.status as Contact["status"]) || "subscribed",
      source: (data.source as Contact["source"]) || "admin",
      createdAt: now,
      updatedAt: now,
    };
    await this.ddb.put(this.table, { ...contact, gsi1pk: contact.status, gsi1sk: contact.emailLower });
    return contact;
  }

  async createConditional(contact: Contact): Promise<void> {
    await this.ddb.putConditional(
      this.table,
      { ...contact, gsi1pk: contact.status, gsi1sk: contact.emailLower },
      "attribute_not_exists(emailLower)",
    );
  }

  async update(emailLower: string, fields: Record<string, unknown>): Promise<void> {
    const updates: Record<string, unknown> = { ...fields, updatedAt: new Date().toISOString() };
    if (updates.status) updates.gsi1pk = updates.status;
    await this.ddb.update(this.table, { emailLower }, updates);
  }

  async list(opts: { status?: string; q?: string; limit: number; cursor?: string }) {
    if (opts.status) {
      return this.ddb.query(this.table, "byStatus", "gsi1pk = :s", { ":s": opts.status }, { limit: opts.limit, cursor: opts.cursor });
    }
    if (opts.q) {
      return this.ddb.scan(this.table, {
        limit: opts.limit * 3,
        cursor: opts.cursor,
        filter: "contains(emailLower, :qLower) OR contains(firstName, :q) OR contains(lastName, :q)",
        values: { ":qLower": opts.q.toLowerCase(), ":q": opts.q },
      });
    }
    return this.ddb.scan(this.table, { limit: opts.limit, cursor: opts.cursor });
  }

  async queryAllSubscribed(): Promise<Contact[]> {
    const items = await this.ddb.queryAll(this.table, "byStatus", "gsi1pk = :s", { ":s": "subscribed" });
    return items as unknown as Contact[];
  }

  async scanAll(): Promise<Contact[]> {
    const items = await this.ddb.scanAll(this.table);
    return items as unknown as Contact[];
  }

  async batchPut(contacts: Contact[]): Promise<void> {
    const items = contacts.map((c) => ({ ...c, gsi1pk: c.status, gsi1sk: c.emailLower }));
    await this.ddb.batchWrite(this.table, items);
  }
}
