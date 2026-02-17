import { Injectable } from "@nestjs/common";
import {
  CreateDataLayerData,
  DataLayer,
  FileUploadRequest
} from "@packages/types";
import { BlobStorageService } from "@/shared/blob-storage/blob-storage.service";
import { DataLayersDatabaseService } from "@/shared/database/services/data-layers.database.service";

export interface CreateDataLayerRequest
  extends Omit<FileUploadRequest, "fileType"> {
  organizationId: string;
  filePath: string;
  fileType: string;
}

@Injectable()
export class FilesService {
  constructor(
    private blobStorageService: BlobStorageService,
    private dataLayersDb: DataLayersDatabaseService
  ) {}

  async generateUploadUrl(
    fileName: string,
    contentType: string,
    organizationId: string,
    projectId: string
  ): Promise<{ uploadUrl: string; s3Key: string }> {
    // Generate S3 key with organization structure
    const timestamp = Date.now();
    const s3Key = `raw/${organizationId}/${projectId}/${timestamp}-${fileName}`;

    // Generate presigned upload URL for processing bucket
    const uploadUrl = await this.blobStorageService.generateUploadUrl(
      s3Key,
      "processing",
      { contentType, expiresIn: 900 } // 15 minutes
    );

    return { uploadUrl, s3Key };
  }

  async createDataLayer(data: CreateDataLayerRequest): Promise<DataLayer> {
    // Ensure fileType is provided
    if (!data.fileType) {
      throw new Error("fileType is required");
    }

    return this.dataLayersDb.createDataLayer({
      ...data,
      fileType: data.fileType,
      sourceType: "upload"
    });
  }

  async createMultipleDataLayers(
    files: Array<{
      name: string;
      description?: string;
      fileType: string;
      s3Key: string;
      fileSize?: number;
      fileHash?: string;
    }>,
    organizationId: string,
    projectId: string
  ): Promise<{
    dataLayers: DataLayer[];
    errors: Array<{ fileName: string; error: string }>;
  }> {
    const dataLayers: DataLayer[] = [];
    const errors: Array<{ fileName: string; error: string }> = [];

    for (const file of files) {
      try {
        if (!file.fileType) {
          throw new Error("fileType is required");
        }

        const dataLayer = await this.dataLayersDb.createDataLayer({
          organizationId,
          projectId,
          name: file.name,
          description: file.description,
          fileType: file.fileType,
          s3Key: file.s3Key,
          filePath: file.s3Key,
          fileSize: file.fileSize,
          fileHash: file.fileHash,
          sourceType: "upload"
        } as CreateDataLayerData);

        dataLayers.push(dataLayer);
      } catch (error) {
        errors.push({
          fileName: file.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return { dataLayers, errors };
  }

  async getDataLayersByProject(projectId: string): Promise<DataLayer[]> {
    return this.dataLayersDb.getDataLayersByProject(projectId);
  }

  async getDataLayerById(dataLayerId: string): Promise<DataLayer | null> {
    return this.dataLayersDb.getDataLayerById(dataLayerId);
  }

  async generateDownloadUrl(
    s3Key: string,
    bucket: "assets" | "processing" = "processing"
  ): Promise<string> {
    return this.blobStorageService.generateDownloadUrl(s3Key, bucket);
  }

  async deleteDataLayer(dataLayerId: string): Promise<void> {
    // Get the data layer to find the S3 key
    const dataLayer = await this.dataLayersDb.getDataLayerById(dataLayerId);
    if (!dataLayer) {
      throw new Error("Data layer not found");
    }

    // Delete from S3
    await this.blobStorageService.deleteFile(dataLayer.filePath, "processing");

    // Delete from database
    await this.dataLayersDb.deleteDataLayer(dataLayerId);
  }

  async updateProcessingStatus(
    dataLayerId: string,
    status: "pending" | "processing" | "completed" | "failed",
    error?: string
  ): Promise<DataLayer> {
    return this.dataLayersDb.updateDataLayerProcessingStatus(
      dataLayerId,
      status,
      error
    );
  }
}
