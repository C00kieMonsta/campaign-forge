import { SendEmailCommand } from "@aws-sdk/client-ses";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@/config/config.service";
import { sesClient } from "@/shared/email/ses-client";

export interface SendInvitationEmailRequest {
  recipientEmail: string;
  recipientName?: string;
  organizationName: string;
  roleName: string;
  inviterName: string;
  invitationToken: string;
  frontendUrl: string;
}

@Injectable()
export class InvitationEmailService {
  private readonly logger = new Logger(InvitationEmailService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendInvitationEmail(
    request: SendInvitationEmailRequest
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const invitationUrl = `${request.frontendUrl}/auth/register?token=${request.invitationToken}&email=${encodeURIComponent(request.recipientEmail)}`;

      const htmlBody = this.generateInvitationEmailHtml(request, invitationUrl);
      const textBody = this.generateInvitationEmailText(request, invitationUrl);

      const emailParams = {
        Source:
          this.configService.getString("AWS_SES_FROM_EMAIL") ||
          "noreply@remorai.solutions",
        Destination: {
          ToAddresses: [request.recipientEmail]
        },
        Message: {
          Subject: {
            Data: `You're invited to join ${request.organizationName}`,
            Charset: "UTF-8"
          },
          Body: {
            Html: {
              Data: htmlBody,
              Charset: "UTF-8"
            },
            Text: {
              Data: textBody,
              Charset: "UTF-8"
            }
          }
        }
      };

      const command = new SendEmailCommand(emailParams);
      const result = await sesClient.send(command);

      this.logger.log(
        `Invitation email sent successfully to ${request.recipientEmail} with message ID: ${result.MessageId}`
      );

      return {
        success: true,
        messageId: result.MessageId
      };
    } catch (error) {
      this.logger.error("Failed to send invitation email:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred"
      };
    }
  }

  private generateInvitationEmailHtml(
    request: SendInvitationEmailRequest,
    invitationUrl: string
  ): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>You're invited to join ${request.organizationName}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .button { 
            display: inline-block; 
            background: #007bff; 
            color: white; 
            padding: 12px 24px; 
            text-decoration: none; 
            border-radius: 6px; 
            margin: 20px 0; 
        }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>You're invited to join ${request.organizationName}</h1>
        </div>
        
        <p>Hi${request.recipientName ? ` ${request.recipientName}` : ""},</p>
        
        <p><strong>${request.inviterName}</strong> has invited you to join <strong>${request.organizationName}</strong> as a <strong>${request.roleName}</strong>.</p>
        
        <p>Click the button below to accept your invitation and create your account:</p>
        
        <a href="${invitationUrl}" class="button">Accept Invitation</a>
        
        <p>Or copy and paste this URL into your browser:</p>
        <p style="word-break: break-all; background: #f8f9fa; padding: 10px; border-radius: 4px;">${invitationUrl}</p>
        
        <p>This invitation will expire in 7 days.</p>
        
        <div class="footer">
            <p>If you didn't expect this invitation, you can safely ignore this email.</p>
            <p>© 2025 Remorai. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`;
  }

  private generateInvitationEmailText(
    request: SendInvitationEmailRequest,
    invitationUrl: string
  ): string {
    return `
You're invited to join ${request.organizationName}

Hi${request.recipientName ? ` ${request.recipientName}` : ""},

${request.inviterName} has invited you to join ${request.organizationName} as a ${request.roleName}.

To accept your invitation and create your account, visit:
${invitationUrl}

This invitation will expire in 7 days.

If you didn't expect this invitation, you can safely ignore this email.

© 2025 Remorai. All rights reserved.
`;
  }
}
