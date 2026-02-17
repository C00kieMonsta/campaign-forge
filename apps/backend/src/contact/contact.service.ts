import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@/config/config.service";
import { sesClient } from "@/shared/email/ses-client";
import { SendEmailCommand } from "@aws-sdk/client-ses";
import { SubmitContactRequest } from "./contact.controller";

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private readonly configService: ConfigService) {}

  async submitDemoRequest(request: SubmitContactRequest) {
    try {
      const { firstName, lastName, email, phone } = request;

      // Validate required fields
      if (!firstName || !email) {
        return {
          success: false,
          error: "First name and email are required",
        };
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return {
          success: false,
          error: "Invalid email format",
        };
      }

      // Build email body
      const emailBody = `
Demo Request Details:

First Name: ${firstName}
Last Name: ${lastName}
Email: ${email}
Phone: ${phone}

---
This is an automated message from RemoRAI Landing Page
      `.trim();

      // Send email via SES
      const params = {
        Source: "support@remorai.solutions",
        Destination: {
          ToAddresses: ["support@remorai.solutions"],
        },
        Message: {
          Subject: {
            Data: `Demo Request from ${firstName} ${lastName || ""}`,
            Charset: "UTF-8",
          },
          Body: {
            Text: {
              Data: emailBody,
              Charset: "UTF-8",
            },
          },
        },
      };

      const command = new SendEmailCommand(params);
      const result = await sesClient.send(command);

      this.logger.log(
        JSON.stringify({
          action: "demo_request_sent",
          messageId: result.MessageId,
          email: email,
        })
      );

      return {
        success: true,
        messageId: result.MessageId,
        message: "Demo request submitted successfully",
      };
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          action: "demo_request_failed",
          error: error instanceof Error ? error.message : "Unknown error",
        })
      );

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to submit request",
      };
    }
  }
}
