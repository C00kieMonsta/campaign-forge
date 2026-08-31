import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "../config/config.service";

/**
 * S3 access for Lex legal documents, bound to LEX_DOCUMENTS_BUCKET — a DEDICATED,
 * versioned/encrypted bucket, never the campaign-attachments bucket (different lifecycle,
 * retention, and confidentiality needs). Client and bucket are resolved lazily so a
 * missing bucket can't crash the shared process at boot.
 */
@Injectable()
export class LexS3Service {
  private client?: S3Client;

  constructor(private config: ConfigService) {}

  private getClient(): S3Client {
    if (!this.client) {
      this.client = new S3Client({ region: this.config.get("AWS_REGION") });
    }
    return this.client;
  }

  private getBucket(): string {
    const bucket = this.config.get("LEX_DOCUMENTS_BUCKET");
    if (!bucket)
      throw new Error(
        "LEX_DOCUMENTS_BUCKET is not configured — Lex document storage is unavailable"
      );
    return bucket;
  }

  /** Uploads an object and returns the S3 version id (bucket versioning is expected to be on). */
  async put(
    key: string,
    body: Buffer,
    contentType: string
  ): Promise<{ versionId?: string }> {
    const res = await this.getClient().send(
      new PutObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
        Body: body,
        ContentType: contentType
      })
    );
    return { versionId: res.VersionId };
  }

  /**
   * Server-side copy, so filing a voice message as a pièce never pulls the bytes through this box.
   *
   * CopySource is URL-encoded: a Lex key contains the owner's email, so it carries an @ and may
   * carry a +, both of which S3 reads as something else in a raw CopySource.
   */
  async copy(fromKey: string, toKey: string): Promise<{ versionId?: string }> {
    const bucket = this.getBucket();
    const res = await this.getClient().send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: toKey,
        CopySource: encodeURIComponent(`${bucket}/${fromKey}`)
      })
    );
    return { versionId: res.VersionId };
  }

  async get(
    key: string,
    versionId?: string
  ): Promise<{ body: Buffer; contentType: string }> {
    const res = await this.getClient().send(
      new GetObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
        VersionId: versionId
      })
    );
    const body = Buffer.from(await res.Body!.transformToByteArray());
    return { body, contentType: res.ContentType ?? "application/octet-stream" };
  }

  async delete(key: string): Promise<void> {
    await this.getClient().send(
      new DeleteObjectCommand({ Bucket: this.getBucket(), Key: key })
    );
  }

  /**
   * A short-lived presigned PUT URL so the browser can upload bytes straight to S3.
   *
   * This is the only upload path: routing document bytes through the API would put them through
   * nginx (capped at 10 MB in prod) and buffer a 100 MB scan in the EC2 box's memory. The
   * browser must send the same Content-Type it was signed with, or S3 rejects the signature.
   *
   * Requires the bucket to allow cross-origin PUT from the admin origin — see the CORS rule on
   * the documents bucket in infrastructure/lib/lex-data-stack.ts.
   */
  async presignedPutUrl(
    key: string,
    contentType: string,
    expiresIn = 900
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.getBucket(),
      Key: key,
      ContentType: contentType
    });
    return getSignedUrl(this.getClient(), command, { expiresIn });
  }

  /**
   * Object metadata, used to confirm the browser's direct upload actually landed before a
   * document is queued for ingestion. Returns null when the object is not there.
   */
  async head(key: string): Promise<{
    size: number;
    versionId?: string;
    contentType?: string;
  } | null> {
    try {
      const res = await this.getClient().send(
        new HeadObjectCommand({ Bucket: this.getBucket(), Key: key })
      );
      return {
        size: res.ContentLength ?? 0,
        versionId: res.VersionId,
        contentType: res.ContentType
      };
    } catch {
      return null; // not found / not yet uploaded
    }
  }

  /** A short-lived presigned GET URL for viewing/listening to a document in the browser. */
  async presignedGetUrl(
    key: string,
    versionId?: string,
    expiresIn = 900
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.getBucket(),
      Key: key,
      VersionId: versionId
    });
    return getSignedUrl(this.getClient(), command, { expiresIn });
  }
}
