import { Injectable } from "@nestjs/common";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ConfigService } from "../config/config.service";

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(private config: ConfigService) {
    this.region = config.get("AWS_REGION");
    this.client = new S3Client({ region: this.region });
    this.bucket = config.get("S3_BUCKET");
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    const body = Buffer.from(await res.Body!.transformToByteArray());
    return { body, contentType: res.ContentType ?? "application/octet-stream" };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  publicUrl(key: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
