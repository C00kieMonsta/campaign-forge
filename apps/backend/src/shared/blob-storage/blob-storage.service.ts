import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@/config/config.service";
import { S3_ERROR_CODES } from "@/shared/database/constants";

export interface PresignedUrlOptions {
  expiresIn?: number; // seconds
  contentType?: string;
}

@Injectable()
export class BlobStorageService {
  private s3Client: S3Client;
  private logger = new Logger(BlobStorageService.name);

  constructor(private configService: ConfigService) {
    const awsConfig = this.configService.getAWSConfig();
    this.s3Client = new S3Client({
      region: awsConfig.region,
      credentials:
        awsConfig.accessKeyId && awsConfig.secretAccessKey
          ? {
              accessKeyId: awsConfig.accessKeyId,
              secretAccessKey: awsConfig.secretAccessKey
            }
          : undefined
    });
  }

  async getFile(key: string): Promise<Buffer> {
    const bucket = this.configService.getFileProcessingBucketName();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });

    const response = await this.s3Client.send(command);
    if (!response.Body) {
      throw new Error("File not found or empty");
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async getContextFile(key: string): Promise<Buffer> {
    const bucket = this.configService.getContextBucketName();

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });

    const response = await this.s3Client.send(command);
    if (!response.Body) {
      throw new Error("File not found or empty");
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async uploadFile(key: string, content: string): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.configService.getFileProcessingBucketName(),
        Key: key,
        Body: content
      })
    );
  }

  async uploadFileToAssets(key: string, content: string): Promise<string> {
    const bucket = this.configService.getAssetsBucketName();
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content
      })
    );
    return key;
  }

  async uploadBufferToAssets(key: string, content: Buffer): Promise<string> {
    const bucket = this.configService.getAssetsBucketName();
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content
      })
    );
    return key;
  }

  // Organization Assets Bucket Operations
  async uploadToAssets(
    key: string,
    content: Buffer | string,
    contentType?: string
  ): Promise<string> {
    const bucket = this.configService.getOrganizationAssetsBucketName();
    if (!bucket) throw new Error("Organization assets bucket not configured");

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: contentType
      })
    );

    return key;
  }

  async getFromAssets(key: string): Promise<Buffer> {
    const bucket = this.configService.getOrganizationAssetsBucketName();
    if (!bucket) throw new Error("Organization assets bucket not configured");

    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key
        })
      );

      return Buffer.from(await response.Body!.transformToByteArray());
    } catch (error: any) {
      if (error.name === S3_ERROR_CODES.NO_SUCH_KEY) {
        throw new Error(`File not found: ${key}`);
      }
      throw error;
    }
  }

  async uploadForProcessing(
    key: string,
    content: Buffer | string,
    contentType?: string
  ): Promise<string> {
    const bucket = this.configService.getFileProcessingBucketName();
    if (!bucket) throw new Error("File processing bucket not configured");

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: contentType
      })
    );

    return key;
  }

  async getFromProcessing(key: string): Promise<Buffer> {
    return this.getFile(key); // Use existing method
  }

  async getFileAsString(
    key: string,
    bucket: "assets" | "processing" = "processing"
  ): Promise<string> {
    const buffer =
      bucket === "assets"
        ? await this.getFromAssets(key)
        : await this.getFromProcessing(key);
    return buffer.toString("utf-8");
  }

  // Presigned URL methods
  async generateUploadUrl(
    key: string,
    bucket: "assets" | "processing",
    options: PresignedUrlOptions = {}
  ): Promise<string> {
    const bucketName =
      bucket === "assets"
        ? this.configService.getOrganizationAssetsBucketName()
        : this.configService.getFileProcessingBucketName();

    if (!bucketName) throw new Error(`${bucket} bucket not configured`);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: options.contentType || "application/octet-stream"
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn: options.expiresIn || 900
    }); // 15 minutes
  }

  async generateDownloadUrl(
    key: string,
    bucket: "assets" | "processing",
    options: PresignedUrlOptions = {}
  ): Promise<string> {
    const bucketName =
      bucket === "assets"
        ? this.configService.getOrganizationAssetsBucketName()
        : this.configService.getFileProcessingBucketName();

    if (!bucketName) throw new Error(`${bucket} bucket not configured`);

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn: options.expiresIn || 600
    }); // 10 minutes
  }

  // Utility methods
  async deleteFile(
    key: string,
    bucket: "assets" | "processing" = "processing"
  ): Promise<void> {
    const bucketName =
      bucket === "assets"
        ? this.configService.getOrganizationAssetsBucketName()
        : this.configService.getFileProcessingBucketName();

    if (!bucketName) throw new Error(`${bucket} bucket not configured`);

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key
      })
    );

    this.logger.log(`Deleted file: ${key} from ${bucket} bucket`);
  }

  async listFiles(
    prefix: string,
    bucket: "assets" | "processing" = "processing"
  ): Promise<string[]> {
    const bucketName =
      bucket === "assets"
        ? this.configService.getOrganizationAssetsBucketName()
        : this.configService.getFileProcessingBucketName();

    if (!bucketName) throw new Error(`${bucket} bucket not configured`);

    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix
    });

    const response = await this.s3Client.send(command);
    return response.Contents?.map((obj) => obj.Key || "").filter(Boolean) || [];
  }

  /**
   * Upload buffer directly to processing bucket
   */
  async uploadToProcessing(
    key: string,
    buffer: Buffer,
    options: { contentType?: string } = {}
  ): Promise<void> {
    const bucketName = this.configService.getFileProcessingBucketName();
    if (!bucketName) throw new Error("Processing bucket not configured");

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: options.contentType || "application/octet-stream"
    });

    await this.s3Client.send(command);
    this.logger.log(`Uploaded file to processing bucket: ${key}`);
  }

  // Backward compatibility methods (deprecated - use new methods above)
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    return this.generateDownloadUrl(key, "assets", { expiresIn });
  }
}
