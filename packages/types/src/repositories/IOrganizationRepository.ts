// src/persistence/IOrganizationRepository.ts
import {
  CreateOrganizationRequest,
  UpdateOrganizationRequest
} from "../dto/organizations";
import { Organization } from "../entities/organization";

export interface IOrganizationRepository {
  getOrganizationById(organizationId: string): Promise<Organization | null>;
  getOrganizationBySlug(slug: string): Promise<Organization | null>;
  getAllOrganizations(): Promise<Organization[]>;
  createOrganization(data: CreateOrganizationRequest): Promise<Organization>;
  updateOrganization(
    organizationId: string,
    data: UpdateOrganizationRequest
  ): Promise<Organization>;
  deleteOrganization(organizationId: string): Promise<void>;
}
