import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Request
} from "@nestjs/common";
import {
  Client,
  ClientListResponse,
  CreateClientRequest,
  CreateClientRequestSchema,
  UpdateClientRequest,
  UpdateClientRequestSchema
} from "@packages/types";
import { ClientsService } from "@/clients/clients.service";
import { Audit } from "@/logger/audit.decorator";
import { AuthenticatedRequest } from "@/shared/types/request.types";

@Controller("clients")
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @Post()
  @Audit({ action: "create", resource: "client" })
  async createClient(
    @Body() body: CreateClientRequest,
    @Request() req: AuthenticatedRequest
  ): Promise<Client> {
    try {
      const data = CreateClientRequestSchema.parse(body);
      const user = req.user;

      if (!user) {
        throw new HttpException(
          "Authentication required",
          HttpStatus.UNAUTHORIZED
        );
      }

      if (!user.organizationId) {
        throw new HttpException(
          "User is not associated with any organization. Please contact your administrator.",
          HttpStatus.FORBIDDEN
        );
      }

      return await this.clientsService.createClient(user.organizationId, data);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error("Failed to create client:", error);
      throw new HttpException(
        "Failed to create client",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get("debug/user")
  @Audit({ action: "debug", resource: "client" })
  async debugUserInfo(@Request() req: AuthenticatedRequest) {
    const user = req.user;
    return {
      authenticated: !!user,
      userId: user?.id,
      email: user?.email,
      organizationId: user?.organizationId,
      role: user?.role,
      hasOrganization: !!user?.organizationId
    };
  }

  @Get()
  async getClients(
    @Query("page") page: string = "1",
    @Query("limit") limit: string = "10",
    @Request() req: AuthenticatedRequest
  ): Promise<ClientListResponse> {
    const t0 = performance.now();
    const timings: Record<string, number> = {};

    const user = req.user;

    if (!user?.organizationId) {
      throw new HttpException(
        "User is not associated with any organization",
        HttpStatus.FORBIDDEN
      );
    }

    const organizationId = user.organizationId;

    const tDb0 = performance.now();
    const result = await this.clientsService.getClientsWithPagination(
      organizationId,
      parseInt(page),
      parseInt(limit)
    );
    timings.db = +(performance.now() - tDb0).toFixed(1);

    // If no clients exist, create a default one for development
    if (result.clients.length === 0) {
      try {
        const tDefaultClient0 = performance.now();
        const defaultClient = await this.clientsService.createClient(
          organizationId,
          {
            name: "Default Client",
            description: "Auto-created default client for development",
            contactName: "John Doe",
            contactEmail: "contact@defaultclient.com",
            contactPhone: "+1-555-0123",
            address: {
              street: "123 Main St",
              city: "Anytown",
              state: "CA",
              zip: "12345",
              country: "USA"
            }
          }
        );
        timings.default_client_creation = +(
          performance.now() - tDefaultClient0
        ).toFixed(1);

        const tJson0 = performance.now();
        const response = {
          clients: [defaultClient],
          total: 1,
          page: parseInt(page),
          limit: parseInt(limit)
        };
        timings.json = +(performance.now() - tJson0).toFixed(1);
        timings.api_total = +(performance.now() - t0).toFixed(1);

        // Add debug timing header
        req.res?.setHeader(
          "X-Debug-Timings",
          Object.entries(timings)
            .map(([k, v]) => `${k}=${v}ms`)
            .join(",")
        );

        return response;
      } catch (error) {
        console.error("Failed to create default client:", error);
      }
    }

    const tJson0 = performance.now();
    timings.json = +(performance.now() - tJson0).toFixed(1);
    timings.api_total = +(performance.now() - t0).toFixed(1);

    // Add debug timing header
    req.res?.setHeader(
      "X-Debug-Timings",
      Object.entries(timings)
        .map(([k, v]) => `${k}=${v}ms`)
        .join(",")
    );

    return result;
  }

  @Get(":id")
  async getClient(
    @Param("id") clientId: string,
    @Request() req: AuthenticatedRequest
  ): Promise<Client | null> {
    const user = req.user;

    if (!user) {
      throw new HttpException(
        "Authentication required",
        HttpStatus.UNAUTHORIZED
      );
    }

    return this.clientsService.getClientById(clientId);
  }

  @Put(":id")
  @Audit({ action: "update", resource: "client" })
  async updateClient(
    @Param("id") clientId: string,
    @Body() body: UpdateClientRequest
  ): Promise<Client> {
    const data = UpdateClientRequestSchema.parse(body);
    return this.clientsService.updateClient(clientId, data);
  }

  @Delete(":id")
  @Audit({ action: "delete", resource: "client" })
  async deleteClient(@Param("id") clientId: string): Promise<void> {
    return this.clientsService.deleteClient(clientId);
  }
}
