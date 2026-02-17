import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import JSZip from "jszip";
import { ASYNC_JOB_STATUSES } from "@packages/types";
import { BlobStorageService } from "@/shared/blob-storage/blob-storage.service";
import { DataLayersDatabaseService } from "@/shared/database/services/data-layers.database.service";

export interface UnzippedFile {
  name: string;
  path: string;
  content: Buffer;
  size: number;
  mimeType: string;
}

export interface ZipProcessingResult {
  success: boolean;
  extractedFiles: UnzippedFile[];
  s3Keys: string[];
  dataLayerIds: string[];
  error?: string;
}

@Injectable()
export class ZipProcessingService {
  private logger = new Logger(ZipProcessingService.name);

  constructor(
    private blobStorageService: BlobStorageService,
    private dataLayersDb: DataLayersDatabaseService
  ) {}

  /**
   * Process a zip file: download, extract, upload individual files to unzipped/ folder
   */
  async processZipFile(
    dataLayerId: string,
    organizationId: string,
    projectId: string
  ): Promise<ZipProcessingResult> {
    try {
      this.logger.log(`Starting zip processing for data layer: ${dataLayerId}`);

      // Get data layer info
      const dataLayer = await this.dataLayersDb.getDataLayerById(dataLayerId);
      if (!dataLayer) {
        throw new Error("Data layer not found");
      }

      // Update status to processing
      await this.dataLayersDb.updateDataLayerProcessingStatus(
        dataLayerId,
        ASYNC_JOB_STATUSES.RUNNING
      );

      // Download zip file from S3
      this.logger.log(`Downloading zip file from: ${dataLayer.filePath}`);
      const zipBuffer = await this.blobStorageService.getFromProcessing(
        dataLayer.filePath
      );

      // Extract files from zip
      const extractedFiles = await this.extractZipContents(
        zipBuffer,
        dataLayer.name
      );
      this.logger.log(`Extracted ${extractedFiles.length} files from zip`);

      if (extractedFiles.length === 0) {
        throw new Error("No valid files found in zip archive");
      }

      // Upload extracted files to unzipped/ folder
      const s3Keys = await this.uploadExtractedFiles(
        extractedFiles,
        organizationId,
        projectId,
        dataLayer.name
      );

      // Create data layer records for each extracted file
      const dataLayerIds = await this.createDataLayersForExtractedFiles(
        extractedFiles,
        s3Keys,
        organizationId,
        projectId,
        dataLayerId
      );

      // Update original zip data layer status
      await this.dataLayersDb.updateDataLayerProcessingStatus(
        dataLayerId,
        ASYNC_JOB_STATUSES.COMPLETED
      );

      this.logger.log(
        `Successfully processed zip file with ${extractedFiles.length} files`
      );

      return {
        success: true,
        extractedFiles,
        s3Keys,
        dataLayerIds
      };
    } catch (error) {
      this.logger.error(
        `Failed to process zip file: ${error instanceof Error ? error.message : String(error)}`,
        error
      );

      // Update status to failed
      await this.dataLayersDb.updateDataLayerProcessingStatus(
        dataLayerId,
        ASYNC_JOB_STATUSES.FAILED
      );

      return {
        success: false,
        extractedFiles: [],
        s3Keys: [],
        dataLayerIds: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Extract contents from zip buffer
   */
  private async extractZipContents(
    zipBuffer: Buffer,
    zipFileName: string
  ): Promise<UnzippedFile[]> {
    const zip = new JSZip();
    const contents = await zip.loadAsync(new Uint8Array(zipBuffer));
    const extractedFiles: UnzippedFile[] = [];

    for (const [relativePath, file] of Object.entries(contents.files)) {
      // Skip directories and system files
      if (
        file.dir ||
        relativePath.startsWith("__MACOSX/") ||
        relativePath.includes(".DS_Store")
      ) {
        continue;
      }

      // Skip hidden files and very small files
      if (relativePath.startsWith(".") || relativePath.includes("/.")) {
        continue;
      }

      try {
        const content = await file.async("nodebuffer");

        // Skip empty files
        if (content.length === 0) {
          continue;
        }

        const fileName = path.basename(relativePath);
        const mimeType = this.getMimeType(fileName);

        // Only process supported file types
        if (this.isSupportedFileType(mimeType)) {
          extractedFiles.push({
            name: fileName,
            path: relativePath,
            content,
            size: content.length,
            mimeType
          });
        } else {
          this.logger.warn(
            `Skipping unsupported file type: ${fileName} (${mimeType})`
          );
        }
      } catch (error) {
        this.logger.warn(
          `Failed to extract file ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }
    }

    return extractedFiles;
  }

  /**
   * Upload extracted files to S3 unzipped/ folder
   */
  private async uploadExtractedFiles(
    extractedFiles: UnzippedFile[],
    organizationId: string,
    projectId: string,
    zipFileName: string
  ): Promise<string[]> {
    const timestamp = Date.now();
    const zipBaseName = path.basename(zipFileName, path.extname(zipFileName));
    const s3Keys: string[] = [];

    for (const file of extractedFiles) {
      const s3Key = `unzipped/${organizationId}/${projectId}/${timestamp}-${zipBaseName}/${file.path}`;

      await this.blobStorageService.uploadToProcessing(s3Key, file.content, {
        contentType: file.mimeType
      });

      s3Keys.push(s3Key);
      this.logger.log(`Uploaded extracted file: ${s3Key}`);
    }

    return s3Keys;
  }

  /**
   * Create data layer records for each extracted file
   */
  private async createDataLayersForExtractedFiles(
    extractedFiles: UnzippedFile[],
    s3Keys: string[],
    organizationId: string,
    projectId: string,
    parentDataLayerId: string
  ): Promise<string[]> {
    const dataLayerIds: string[] = [];

    for (let i = 0; i < extractedFiles.length; i++) {
      const file = extractedFiles[i];
      const s3Key = s3Keys[i];

      const dataLayer = await this.dataLayersDb.createDataLayer({
        organizationId,
        projectId,
        name: file.name,
        fileType: this.getFileType(file.mimeType),
        s3Key: s3Key,
        filePath: s3Key,
        fileSize: file.size,
        fileHash: await this.calculateFileHash(file.content),
        sourceType: "zip_extraction",
        sourceMetadata: {
          parentDataLayerId,
          originalPath: file.path,
          extractedFromZip: true
        }
      });

      dataLayerIds.push(dataLayer.id);
      this.logger.log(
        `Created data layer for extracted file: ${file.name} (ID: ${dataLayer.id})`
      );
    }

    return dataLayerIds;
  }

  /**
   * Check if file type is supported for processing
   */
  private isSupportedFileType(mimeType: string): boolean {
    const supportedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/csv"
    ];

    return supportedTypes.includes(mimeType) || mimeType.startsWith("image/");
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".doc": "application/msword",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".txt": "text/plain",
      ".csv": "text/csv"
    };

    return mimeTypes[ext] || "application/octet-stream";
  }

  /**
   * Get file type for database storage
   */
  private getFileType(mimeType: string): string {
    if (mimeType === "application/pdf") return "pdf";
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.includes("word") || mimeType.includes("document"))
      return "docx";
    if (mimeType.includes("excel") || mimeType.includes("spreadsheet"))
      return "xlsx";
    if (mimeType === "text/csv") return "csv";
    if (mimeType === "text/plain") return "other";
    return "other";
  }

  /**
   * Calculate SHA256 hash of file content
   */
  private async calculateFileHash(buffer: Buffer): Promise<string> {
    const crypto = await import("crypto");
    return crypto
      .createHash("sha256")
      .update(new Uint8Array(buffer))
      .digest("hex");
  }
}
