// src/persistence/IRoleRepository.ts
import { Role } from "../entities/roles";

export interface CreateRoleData {
  name: string;
  slug: string;
  description?: string;
  organizationId?: string;
  isSystem?: boolean;
}

export interface IRoleRepository {
  getRoleById(roleId: string): Promise<Role | null>;
  getRolesByOrganizationId(organizationId: string): Promise<Role[]>;
  getSystemRoles(): Promise<Role[]>;
  getAvailableRoles(organizationId: string): Promise<Role[]>;
  createRole(data: CreateRoleData): Promise<Role>;
  updateRole(roleId: string, data: Partial<Role>): Promise<Role>;
  deleteRole(roleId: string): Promise<void>;
}
