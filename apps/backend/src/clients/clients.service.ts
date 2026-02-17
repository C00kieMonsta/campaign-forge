import { Injectable } from "@nestjs/common";
import {
  Client,
  ClientListResponse,
  CreateClientRequest,
  UpdateClientRequest
} from "@packages/types";
import { ClientsDatabaseService } from "@/shared/database/services/clients.database.service";

@Injectable()
export class ClientsService {
  constructor(private clientsDb: ClientsDatabaseService) {}

  async createClient(
    organizationId: string,
    data: CreateClientRequest
  ): Promise<Client> {
    return this.clientsDb.createClient({
      ...data,
      organizationId
    });
  }

  async getClientById(clientId: string): Promise<Client | null> {
    return this.clientsDb.getClientById(clientId);
  }

  async getClientsByOrganization(organizationId: string): Promise<Client[]> {
    return this.clientsDb.getClientsByOrganization(organizationId);
  }

  async updateClient(
    clientId: string,
    data: UpdateClientRequest
  ): Promise<Client> {
    return this.clientsDb.updateClient(clientId, data);
  }

  async deleteClient(clientId: string): Promise<void> {
    return this.clientsDb.deleteClient(clientId);
  }

  async getClientsWithPagination(
    organizationId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<ClientListResponse> {
    const { clients, total } =
      await this.clientsDb.getClientsByOrganizationWithPagination(
        organizationId,
        page,
        limit
      );

    return {
      clients,
      total,
      page,
      limit
    };
  }
}
