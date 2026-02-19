import { Injectable } from "@nestjs/common";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { ConfigService } from "../config/config.service";

@Injectable()
export class SesService {
  private readonly client: SESClient;
  private readonly fromEmail: string;

  constructor(private config: ConfigService) {
    this.client = new SESClient({ region: config.get("SES_REGION") });
    this.fromEmail = config.get("SES_FROM_EMAIL");
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    await this.client.send(new SendEmailCommand({
      Source: this.fromEmail,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: html } },
      },
    }));
  }

  async sendBatch(
    emails: { to: string; subject: string; html: string }[],
    concurrency = 5,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    const queue = [...emails];

    const worker = async () => {
      while (queue.length > 0) {
        const email = queue.shift()!;
        try {
          await this.send(email.to, email.subject, email.html);
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
