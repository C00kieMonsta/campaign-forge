import { Injectable } from "@nestjs/common";
import {
  Client,
  CreateClientData,
  IClientRepository,
  UpdateClientRequest
} from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class ClientsDatabaseService
  extends BaseDatabaseService
  implements IClientRepository
{
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }
  async createClient(data: CreateClientData): Promise<Client> {
    this.logger.info("Creating new client", {
      ...this.context,
      clientName: data.name,
      organizationId: data.organizationId
    });

    try {
      const client = await this.prisma.client.create({
        data: {
          organizationId: data.organizationId,
          name: data.name,
          description: data.description,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          address: data.address
        }
      });

      return client;
    } catch (error) {
      this.logger.error("Failed to create client", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        organizationId: data.organizationId,
        clientName: data.name
      });

      throw new Error(
        `Failed to create client: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getClientsByOrganization(organizationId: string): Promise<Client[]> {
    try {
      const clients = await this.prisma.client.findMany({
        where: { organizationId },
        orderBy: { name: "asc" }
      });

      return clients;
    } catch (error) {
      this.logger.error("Failed to fetch clients", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to fetch clients: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getClientsByOrganizationWithPagination(
    organizationId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ clients: Client[]; total: number }> {
    try {
      const skip = (page - 1) * limit;

      const [clients, total] = await Promise.all([
        this.prisma.client.findMany({
          where: { organizationId },
          orderBy: { name: "asc" },
          skip,
          take: limit
        }),
        this.prisma.client.count({
          where: { organizationId }
        })
      ]);

      return { clients, total };
    } catch (error) {
      this.logger.error("Failed to fetch clients with pagination", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to fetch clients with pagination: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getClientById(clientId: string): Promise<Client | null> {
    try {
      const client = await this.prisma.client.findUnique({
        where: { id: clientId }
      });

      return client;
    } catch (error) {
      throw new Error(
        `Failed to get client: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateClient(
    clientId: string,
    updates: UpdateClientRequest
  ): Promise<Client> {
    try {
      const client = await this.prisma.client.update({
        where: { id: clientId },
        data: {
          name: updates.name,
          description: updates.description,
          contactName: updates.contactName,
          contactEmail: updates.contactEmail,
          contactPhone: updates.contactPhone,
          address: updates.address
        }
      });

      return client;
    } catch (error) {
      throw new Error(
        `Failed to update client: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async deleteClient(clientId: string): Promise<void> {
    try {
      await this.prisma.client.delete({
        where: { id: clientId }
      });
    } catch (error) {
      throw new Error(
        `Failed to delete client: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
