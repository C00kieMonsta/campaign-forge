import { SendRawEmailCommand } from "@aws-sdk/client-ses";
import { Injectable, Logger } from "@nestjs/common";
import { BlobStorageService } from "@/shared/blob-storage/blob-storage.service";
import { sesClient } from "@/shared/email/ses-client";

export interface EmailAttachment {
  name: string;
  buffer: Buffer | number[]; // Can be Buffer or array of numbers from frontend
  contentType: string;
}

export interface SendEmailRequest {
  toEmails: string[];
  ccEmails?: string[];
  subject: string;
  body: string;
  s3DocumentUri: string;
  fileType: "docx" | "pdf";
  senderEmail: string;
  senderName: string;
  attachmentFilename?: string;
  additionalAttachments?: EmailAttachment[];
  reportSpecificAttachments?: Array<{
    s3Key: string;
    filename: string;
  }>;
}

export interface SendEmailResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly blobStorageService: BlobStorageService) {}

  async sendEmail(request: SendEmailRequest): Promise<SendEmailResponse> {
    try {
      this.logger.log(`Sending email to ${request.toEmails.join(", ")}`);
      this.logger.log(`Document URI: ${request.s3DocumentUri}`);
      this.logger.log(`File type: ${request.fileType}`);

      // Validate email addresses
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const allEmails = [...request.toEmails, ...(request.ccEmails || [])];

      if (!allEmails.every((email) => emailRegex.test(email))) {
        throw new Error("Invalid email format detected");
      }

      // Download main report from S3
      // Reports are stored in assets bucket (isAsset=true) based on frontend logic
      const mainReportBuffer = await this.downloadFromS3(
        request.s3DocumentUri,
        true
      );

      // Download report-specific attachments
      const reportAttachments = await this.downloadReportAttachments(
        request.reportSpecificAttachments || []
      );

      // Build email content
      const emailContent = this.buildEmailContent(request, mainReportBuffer, [
        ...reportAttachments,
        ...(request.additionalAttachments || [])
      ]);

      // Send via SES
      const command = new SendRawEmailCommand({
        RawMessage: {
          Data: Uint8Array.from(Buffer.from(emailContent))
        }
      });

      const result = await sesClient.send(command);

      this.logger.log(
        `Email sent successfully with message ID: ${result.MessageId}`
      );

      return {
        success: true,
        messageId: result.MessageId
      };
    } catch (error) {
      this.logger.error("Failed to send email:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred"
      };
    }
  }

  private async downloadFromS3(
    s3Key: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _isAsset: boolean = true
  ): Promise<Buffer> {
    // _isAsset parameter is kept for future use but currently not implemented
    try {
      // Use the appropriate bucket based on the isAsset parameter
      // This mimics the frontend fetchPresignedDownloadUrl logic
      const presignedUrl = await this.blobStorageService.getSignedUrl(
        s3Key,
        600
      );

      if (!presignedUrl) {
        throw new Error(
          `Could not generate presigned URL for S3 key: ${s3Key}`
        );
      }

      const response = await fetch(presignedUrl);

      if (!response.ok) {
        throw new Error(
          `Failed to download file from S3: ${s3Key} (Status: ${response.status})`
        );
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      this.logger.error(`Error downloading from S3 (${s3Key}):`, error);
      throw error;
    }
  }

  private async downloadReportAttachments(
    attachments: Array<{ s3Key: string; filename: string }>
  ): Promise<EmailAttachment[]> {
    const results: EmailAttachment[] = [];

    for (const attachment of attachments) {
      try {
        // Use specialized function for attachment S3 keys (similar to frontend logic)
        // Report attachments are stored in assets bucket like the main report
        const presignedUrl = await this.blobStorageService.getSignedUrl(
          attachment.s3Key,
          600
        );

        if (!presignedUrl) {
          this.logger.warn(
            `Could not get presigned URL for attachment: ${attachment.s3Key}`
          );
          continue;
        }

        const response = await fetch(presignedUrl);

        if (!response.ok) {
          this.logger.warn(
            `Failed to fetch attachment from S3: ${attachment.s3Key}`
          );
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        // Determine content type based on file extension
        let contentType = "application/octet-stream";
        const extension = attachment.filename.split(".").pop()?.toLowerCase();

        switch (extension) {
          case "pdf":
            contentType = "application/pdf";
            break;
          case "png":
            contentType = "image/png";
            break;
          case "jpg":
          case "jpeg":
            contentType = "image/jpeg";
            break;
          case "txt":
            contentType = "text/plain";
            break;
        }

        results.push({
          name: attachment.filename,
          buffer,
          contentType
        });
      } catch (error) {
        this.logger.warn(
          `Failed to download attachment ${attachment.s3Key}:`,
          error
        );
        // Continue with other attachments
      }
    }

    return results;
  }

  private buildEmailContent(
    request: SendEmailRequest,
    mainReportBuffer: Buffer,
    attachments: EmailAttachment[]
  ): string {
    const boundary = `----=_Part_${Date.now().toString()}`;

    const createAttachmentPart = (
      filename: string,
      buffer: Buffer | number[],
      contentType: string
    ) => {
      // Convert array of numbers to Buffer if needed
      const bufferData = Array.isArray(buffer) ? Buffer.from(buffer) : buffer;

      return (
        `--${boundary}\r\n` +
        `Content-Type: ${contentType}\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${filename}"\r\n\r\n` +
        `${bufferData.toString("base64")}\r\n`
      );
    };

    const mainReportContentType =
      request.fileType === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const mainReportFileName =
      request.attachmentFilename ||
      request.s3DocumentUri.split("/").pop() ||
      `report.${request.fileType}`;

    // Use a verified email address for From header, but set Reply-To to actual sender
    // This allows sending through SES while preserving the sender's identity for replies
    let emailContent =
      `From: "Wizards" <admin@wizards.ai>\r\n` +
      `Reply-To: "${request.senderName}" <${request.senderEmail}>\r\n` +
      `To: ${request.toEmails.join(", ")}\r\n` +
      `${request.ccEmails && request.ccEmails.length > 0 ? `Cc: ${request.ccEmails.join(", ")}\r\n` : ""}` +
      `Subject: ${request.subject} - from ${request.senderName}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: 7bit\r\n\r\n` +
      `${request.body?.replace(/\n/g, "<br>\r\n")}\r\n\r\n` +
      createAttachmentPart(
        mainReportFileName,
        mainReportBuffer,
        mainReportContentType
      );

    // Add all additional attachments
    attachments.forEach((attachment) => {
      emailContent += createAttachmentPart(
        attachment.name,
        attachment.buffer,
        attachment.contentType
      );
    });

    emailContent += `--${boundary}--\r\n`;

    return emailContent;
  }
}
