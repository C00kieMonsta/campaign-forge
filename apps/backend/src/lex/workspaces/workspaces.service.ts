import { Injectable, NotFoundException } from "@nestjs/common";
import type { LexWorkspace } from "@packages/types";
import { PgService } from "../../shared/pg.service";

interface WorkspaceRow {
  id: string;
  owner_email: string;
  name: string;
  description: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapWorkspace(r: WorkspaceRow): LexWorkspace {
  return {
    id: r.id,
    ownerEmail: r.owner_email,
    name: r.name,
    description: r.description,
    status: r.status,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  };
}

@Injectable()
export class WorkspacesService {
  constructor(private pg: PgService) {}

  /** Upsert the lex_users row so FK-scoped inserts never violate (single-tenant now). */
  async ensureUser(email: string): Promise<void> {
    await this.pg.query(
      `INSERT INTO lex_users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [email]
    );
  }

  async create(
    ownerEmail: string,
    data: { name: string; description?: string }
  ): Promise<LexWorkspace> {
    await this.ensureUser(ownerEmail);
    const res = await this.pg.query<WorkspaceRow>(
      `INSERT INTO lex_workspaces (owner_email, name, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [ownerEmail, data.name, data.description ?? null]
    );
    return mapWorkspace(res.rows[0]);
  }

  async list(ownerEmail: string): Promise<LexWorkspace[]> {
    const res = await this.pg.query<WorkspaceRow>(
      `SELECT * FROM lex_workspaces WHERE owner_email = $1 ORDER BY updated_at DESC`,
      [ownerEmail]
    );
    return res.rows.map(mapWorkspace);
  }

  async getOrFail(ownerEmail: string, id: string): Promise<LexWorkspace> {
    const res = await this.pg.query<WorkspaceRow>(
      `SELECT * FROM lex_workspaces WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
    if (res.rows.length === 0)
      throw new NotFoundException("Workspace not found");
    return mapWorkspace(res.rows[0]);
  }

  async update(
    ownerEmail: string,
    id: string,
    data: { name?: string; description?: string; status?: string }
  ): Promise<LexWorkspace> {
    const res = await this.pg.query<WorkspaceRow>(
      `UPDATE lex_workspaces SET
         name = COALESCE($3, name),
         description = COALESCE($4, description),
         status = COALESCE($5, status),
         updated_at = now()
       WHERE id = $1 AND owner_email = $2
       RETURNING *`,
      [
        id,
        ownerEmail,
        data.name ?? null,
        data.description ?? null,
        data.status ?? null
      ]
    );
    if (res.rows.length === 0)
      throw new NotFoundException("Workspace not found");
    return mapWorkspace(res.rows[0]);
  }

  async delete(ownerEmail: string, id: string): Promise<void> {
    const res = await this.pg.query(
      `DELETE FROM lex_workspaces WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
    if (res.rowCount === 0) throw new NotFoundException("Workspace not found");
  }
}
