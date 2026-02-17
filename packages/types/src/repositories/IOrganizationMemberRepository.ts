// src/persistence/IOrganizationMemberRepository.ts
import { OrganizationMember } from "../entities/organization_member";

export interface CreateOrganizationMemberData {
  organizationId: string;
  userId: string;
  roleId: string;
}

export interface IOrganizationMemberRepository {
  getOrganizationMemberById(
    memberId: string
  ): Promise<OrganizationMember | null>;
  getOrganizationMembers(organizationId: string): Promise<OrganizationMember[]>;
  addOrganizationMember(
    data: CreateOrganizationMemberData
  ): Promise<OrganizationMember>;
  updateOrganizationMemberRole(
    memberId: string,
    roleId: string
  ): Promise<OrganizationMember>;
  updateOrganizationMemberStatus(
    memberId: string,
    status: string
  ): Promise<OrganizationMember>;
  removeOrganizationMember(memberId: string): Promise<void>;
}
