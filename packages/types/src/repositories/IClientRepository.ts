// src/persistence/IClientRepository.ts
import { CreateClientRequest, UpdateClientRequest } from "../dto/clients";
import { Client } from "../entities/client";

export interface CreateClientData extends CreateClientRequest {
  organizationId: string;
}

export interface IClientRepository {
  getClientById(clientId: string): Promise<Client | null>;
  getClientsByOrganization(organizationId: string): Promise<Client[]>;
  createClient(data: CreateClientData): Promise<Client>;
  updateClient(clientId: string, data: UpdateClientRequest): Promise<Client>;
  deleteClient(clientId: string): Promise<void>;
  getClientsByOrganizationWithPagination(
    organizationId: string,
    page: number,
    limit: number
  ): Promise<{ clients: Client[]; total: number }>;
}
