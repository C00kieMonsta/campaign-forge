import { Injectable } from "@nestjs/common";
import { SESClient, SendEmailCommand, SendRawEmailCommand } from "@aws-sdk/client-ses";
import MailComposer from "nodemailer/lib/mail-composer";
import { ConfigService } from "../config/config.service";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

@Injectable()
export class SesService {
  private readonly client: SESClient;
  private readonly fromEmail: string;

  constructor(private config: ConfigService) {
    this.client = new SESClient({ region: config.get("SES_REGION") });
    this.fromEmail = config.get("SES_FROM_EMAIL");
  }

  private async sendSimple(to: string, subject: string, html: string): Promise<void> {
    await this.client.send(new SendEmailCommand({
      Source: this.fromEmail,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: html } },
      },
    }));
  }

  private async sendRaw(to: string, subject: string, html: string, attachments: EmailAttachment[]): Promise<void> {
    const mail = new MailComposer({
      from: this.fromEmail,
      to,
      subject,
      html,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    const message = await mail.compile().build();
    await this.client.send(new SendRawEmailCommand({ RawMessage: { Data: new Uint8Array(message) } }));
  }

  private async sendWithRetry(to: string, subject: string, html: string, attachments?: EmailAttachment[], maxRetries = 4): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attachments?.length) {
          await this.sendRaw(to, subject, html, attachments);
        } else {
          await this.sendSimple(to, subject, html);
        }
        return;
      } catch (err: unknown) {
        const isThrottled = err instanceof Error && err.message.includes("Maximum sending rate exceeded");
        if (!isThrottled || attempt === maxRetries) throw err;
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    await this.sendWithRetry(to, subject, html);
  }

  async sendWithAttachments(to: string, subject: string, html: string, attachments: EmailAttachment[]): Promise<void> {
    await this.sendWithRetry(to, subject, html, attachments);
  }

  async sendBatch(
    emails: { to: string; subject: string; html: string }[],
    attachments: EmailAttachment[] = [],
    concurrency = 2,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    const queue = [...emails];

    const worker = async () => {
      while (queue.length > 0) {
        const email = queue.shift()!;
        try {
          await this.sendWithRetry(email.to, email.subject, email.html, attachments);
          sent++;
        } catch (err) {
          console.log(JSON.stringify({ level: "error", action: "sendEmailFailed", to: email.to, error: String(err) }));
          failed++;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, emails.length) }, worker));
    return { sent, failed };
  }
}
