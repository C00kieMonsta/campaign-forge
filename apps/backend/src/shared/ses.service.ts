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

  private async sendWithRetry(to: string, subject: string, html: string, maxRetries = 4): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.client.send(new SendEmailCommand({
          Source: this.fromEmail,
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: subject },
            Body: { Html: { Data: html } },
          },
        }));
        return;
      } catch (err: unknown) {
        const isThrottled = err instanceof Error && err.message.includes("Maximum sending rate exceeded");
        if (!isThrottled || attempt === maxRetries) throw err;
        // Exponential backoff: 1s, 2s, 4s, 8s
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    await this.sendWithRetry(to, subject, html);
  }

  async sendBatch(
    emails: { to: string; subject: string; html: string }[],
    concurrency = 2,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    const queue = [...emails];

    const worker = async () => {
      while (queue.length > 0) {
        const email = queue.shift()!;
        try {
          await this.sendWithRetry(email.to, email.subject, email.html);
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
