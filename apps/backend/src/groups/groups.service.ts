import { Injectable } from "@nestjs/common";
import { DdbService } from "../shared/ddb.service";
import type { ContactGroup } from "@packages/types";

@Injectable()
export class GroupsService {
  private get table() {
    return this.ddb.tables.groups;
  }

  constructor(private ddb: DdbService) {}

  async list(): Promise<ContactGroup[]> {
    const items = await this.ddb.scanAll(this.table);
    return (items as unknown as ContactGroup[]).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  async create(data: { name: string; color: string }): Promise<ContactGroup> {
    const now = new Date().toISOString();
    const group: ContactGroup = {
      id: crypto.randomUUID(),
      name: data.name.trim(),
      color: data.color,
      createdAt: now,
      updatedAt: now,
    };
    await this.ddb.put(this.table, group as unknown as Record<string, unknown>);
    return group;
  }

  async update(id: string, data: { name?: string; color?: string }): Promise<void> {
    await this.ddb.update(this.table, { id }, { ...data, updatedAt: new Date().toISOString() });
  }

  async delete(id: string): Promise<void> {
    await this.ddb.delete(this.table, { id });
  }
}
