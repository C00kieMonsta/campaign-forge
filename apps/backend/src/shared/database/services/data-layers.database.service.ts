import { Injectable } from "@nestjs/common";
import {
  CreateDataLayerData,
  DataLayer,
  IDataLayerRepository
} from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class DataLayersDatabaseService
  extends BaseDatabaseService
  implements IDataLayerRepository
{
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }

  async createDataLayer(data: CreateDataLayerData): Promise<DataLayer> {
    this.logger.info("Creating data layer", {
      ...this.context,
      name: data.name,
      fileType: data.fileType
    });

    try {
      const dataLayer = await this.prisma.dataLayer.create({
        data: {
          organizationId: data.organizationId,
          projectId: data.projectId,
          name: data.name,
          description: data.description,
          fileType: data.fileType,
          filePath: data.filePath,
          fileSize: data.fileSize ? BigInt(data.fileSize) : null,
          fileHash: data.fileHash,
          sourceType: data.sourceType || "upload",
          sourceMetadata: (data.sourceMetadata as any) || {},
          processingStatus: "pending",
          parentId: data.parentId
        }
      });

      return dataLayer;
    } catch (error) {
      this.logger.error("Failed to create data layer", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        name: data.name
      });
      throw error;
    }
  }

  async getDataLayerById(dataLayerId: string): Promise<DataLayer | null> {
    try {
      const dataLayer = await this.prisma.dataLayer.findUnique({
        where: {
          id: dataLayerId
        }
      });

      if (!dataLayer) {
        return null;
      }

      return dataLayer;
    } catch (error) {
      this.logger.error("Failed to get data layer by ID", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        dataLayerId
      });
      throw error;
    }
  }

  async getDataLayersByProject(projectId: string): Promise<DataLayer[]> {
    try {
      const dataLayers = await this.prisma.dataLayer.findMany({
        where: {
          projectId
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return dataLayers;
    } catch (error) {
      this.logger.error("Failed to get data layers by project", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        projectId
      });
      throw error;
    }
  }

  async updateDataLayerProcessingStatus(
    dataLayerId: string,
    status: string,
    error?: string
  ): Promise<DataLayer> {
    try {
      const dataLayer = await this.prisma.dataLayer.update({
        where: {
          id: dataLayerId
        },
        data: {
          processingStatus: status,
          processingError: error || null,
          processedAt:
            status === "completed" || status === "failed" ? new Date() : null,
          updatedAt: new Date()
        }
      });

      return dataLayer;
    } catch (error) {
      this.logger.error("Failed to update data layer processing status", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        dataLayerId,
        status
      });
      throw error;
    }
  }

  async deleteDataLayer(dataLayerId: string): Promise<void> {
    try {
      await this.prisma.dataLayer.delete({
        where: {
          id: dataLayerId
        }
      });
    } catch (error) {
      this.logger.error("Failed to delete data layer", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        dataLayerId
      });
      throw error;
    }
  }
}
