import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request
} from "@nestjs/common";
import {
  BatchFileUploadRequest,
  BatchFileUploadRequestSchema,
  BatchFileUploadResponse,
  DataLayer,
  DataLayerListResponse,
  FileUploadRequest,
  FileUploadRequestSchema,
  FileUploadResponse,
  TABLE_NAMES
} from "@packages/types";
import { ExtractionWorkflowService } from "@/extraction/services/extraction-workflow.service";
import { FilesService } from "@/files/files.service";
import { Audit } from "@/logger/audit.decorator";
import { AuthenticatedRequest } from "@/shared/types/request.types";

@Controller(TABLE_NAMES.DATA_LAYERS)
export class FilesController {
  constructor(
    private filesService: FilesService,
    private extractionWorkflowService: ExtractionWorkflowService
  ) {}

  @Post("upload-url")
  async generateUploadUrl(
    @Body()
    body: {
      fileName: string;
      contentType: string;
      projectId: string;
    },
    @Request() req: AuthenticatedRequest
  ): Promise<{ uploadUrl: string; s3Key: string }> {
    const user = req.user;
    if (!user) {
      throw new Error("User not authenticated");
    }
    if (!user.organizationId) {
      throw new Error("User is not associated with any organization");
    }
    const organizationId = user.organizationId;

    return this.filesService.generateUploadUrl(
      body.fileName,
      body.contentType,
      organizationId,
      body.projectId
    );
  }

  @Post("upload")
  @Audit({ action: "upload", resource: "file" })
  async createDataLayer(
    @Body() body: FileUploadRequest,
    @Request() req: AuthenticatedRequest
  ): Promise<FileUploadResponse> {
    try {
      const data = FileUploadRequestSchema.parse(body);
      const user = req.user;
      if (!user) {
        throw new Error("User not authenticated");
      }
      if (!user.organizationId) {
        throw new Error("User is not associated with any organization");
      }
      const organizationId = user.organizationId;

      const dataLayer = await this.filesService.createDataLayer({
        ...data,
        organizationId,
        filePath: data.s3Key,
        fileType: data.fileType
      });

      // Note: Extraction jobs are now started explicitly via batch endpoints
      // Individual file uploads no longer auto-start extraction jobs

      return {
        dataLayer
      };
    } catch (error) {
      console.error("File upload failed:", error);

      // Return appropriate error response
      if (error instanceof Error) {
        if (error.message.includes("PDF processing tools not available")) {
          throw new Error(
            "Server configuration error: PDF processing tools are not available"
          );
        }
        if (error.message.includes("Invalid PDF")) {
          throw new Error(
            "Invalid PDF file. Please ensure the file is a valid PDF document."
          );
        }
      }

      throw error;
    }
  }

  @Post("batch-upload")
  @Audit({ action: "batch_upload", resource: "files" })
  async batchUploadFiles(
    @Body() body: BatchFileUploadRequest,
    @Request() req: AuthenticatedRequest
  ): Promise<BatchFileUploadResponse> {
    try {
      const data = BatchFileUploadRequestSchema.parse(body);
      const user = req.user;
      if (!user) {
        throw new Error("User not authenticated");
      }
      if (!user.organizationId) {
        throw new Error("User is not associated with any organization");
      }
      const organizationId = user.organizationId;

      const result = await this.filesService.createMultipleDataLayers(
        data.files,
        organizationId,
        data.projectId
      );

      return {
        dataLayers: result.dataLayers,
        totalUploaded: result.dataLayers.length,
        errors: result.errors.length > 0 ? result.errors : undefined
      };
    } catch (error) {
      console.error("Batch file upload failed:", error);
      throw error;
    }
  }

  @Get("project/:projectId")
  async getProjectFiles(
    @Param("projectId") projectId: string
  ): Promise<DataLayerListResponse> {
    try {
      const dataLayers =
        await this.filesService.getDataLayersByProject(projectId);

      // Organize files with parent-child relationships
      const organizedFiles = this.organizeFilesWithHierarchy(dataLayers);

      return {
        dataLayers: organizedFiles,
        total: organizedFiles.length,
        page: 1,
        limit: organizedFiles.length
      };
    } catch (error) {
      console.error(`Failed to get project files for ${projectId}:`, error);
      throw error;
    }
  }

  @Get(":id")
  async getDataLayer(
    @Param("id") dataLayerId: string
  ): Promise<DataLayer | null> {
    return this.filesService.getDataLayerById(dataLayerId);
  }

  @Get(":id/download-url")
  async generateDownloadUrl(
    @Param("id") dataLayerId: string,
    @Query("bucket") bucket: "assets" | "processing" = "processing"
  ): Promise<{ downloadUrl: string }> {
    const dataLayer = await this.filesService.getDataLayerById(dataLayerId);
    if (!dataLayer) {
      throw new Error("Data layer not found");
    }

    const downloadUrl = await this.filesService.generateDownloadUrl(
      dataLayer.filePath,
      bucket
    );

    return { downloadUrl };
  }

  @Delete(":id")
  @Audit({ action: "delete", resource: "file" })
  async deleteDataLayer(@Param("id") dataLayerId: string): Promise<void> {
    return this.filesService.deleteDataLayer(dataLayerId);
  }

  /**
   * Organize files with parent-child hierarchy for zip files
   */
  private organizeFilesWithHierarchy(dataLayers: DataLayer[]): DataLayer[] {
    return dataLayers;
  }
}
