import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { getEnv } from "./env";

let client: SESClient | null = null;

function ses(): SESClient {
  if (client) return client;
  client = new SESClient({ region: getEnv().SES_REGION });
  return client;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  await ses().send(new SendEmailCommand({
    Source: getEnv().SES_FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html } },
    },
  }));
}

export async function sendBatch(
  emails: { to: string; subject: string; html: string }[],
  concurrency = 5,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const queue = [...emails];

  async function worker() {
    while (queue.length > 0) {
      const email = queue.shift()!;
      try {
        await sendEmail(email.to, email.subject, email.html);
        sent++;
      } catch (err) {
        console.log(JSON.stringify({ level: "error", action: "sendEmailFailed", to: email.to, error: String(err) }));
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, emails.length) }, worker));
  return { sent, failed };
}
