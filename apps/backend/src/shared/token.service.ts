import { createHmac, timingSafeEqual } from "crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "../config/config.service";

const TTL_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.secret = config.get("UNSUBSCRIBE_SECRET");
    this.baseUrl = config.get("PUBLIC_BASE_URL");
  }

  sign(emailLower: string, ttlMs = TTL_MS): string {
    const payload = `${emailLower}|${Date.now() + ttlMs}`;
    const sig = createHmac("sha256", this.secret)
      .update(payload)
      .digest("base64url");
    return Buffer.from(`${payload}.${sig}`).toString("base64url");
  }

  verify(
    token: string
  ): { valid: true; emailLower: string } | { valid: false; error: string } {
    try {
      const decoded = Buffer.from(token, "base64url").toString();
      const dotIdx = decoded.lastIndexOf(".");
      if (dotIdx === -1) return { valid: false, error: "invalid_format" };

      const payload = decoded.slice(0, dotIdx);
      const sig = decoded.slice(dotIdx + 1);
      const expected = createHmac("sha256", this.secret)
        .update(payload)
        .digest("base64url");

      const sigBuf = new Uint8Array(Buffer.from(sig));
      const expBuf = new Uint8Array(Buffer.from(expected));
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false, error: "invalid_signature" };
      }

      const pipeIdx = payload.lastIndexOf("|");
      if (pipeIdx === -1) return { valid: false, error: "invalid_format" };

      const expiry = parseInt(payload.slice(pipeIdx + 1), 10);
      if (isNaN(expiry) || Date.now() > expiry)
        return { valid: false, error: "expired" };

      return { valid: true, emailLower: payload.slice(0, pipeIdx) };
    } catch {
      return { valid: false, error: "invalid_format" };
    }
  }

  unsubscribeUrl(emailLower: string): string {
    return `${this.baseUrl}/public/unsubscribe?token=${encodeURIComponent(this.sign(emailLower))}`;
  }

  appendFooter(html: string, emailLower: string): string {
    const url = this.unsubscribeUrl(emailLower);
    const footer = `
<div style="margin-top:40px;padding-top:20px;border-top:1px solid #e0e0e0;font-size:12px;color:#999;text-align:center;font-family:Arial,sans-serif">
  <p style="margin:0 0 6px 0"><strong style="color:#555">Monique Pirson</strong><br>Belgium</p>
  <p style="margin:0 0 6px 0">Ne répondez pas à cet email. Pour nous contacter, envoyez un email à <a href="mailto:monpirson@gmail.com" style="color:#999">monpirson@gmail.com</a> ou appelez le <a href="tel:+32475429420" style="color:#999">+32 475 42 94 20</a>.</p>
  <p style="margin:0"><a href="${url}" style="color:#999;text-decoration:underline">Se désabonner</a></p>
</div>`;
    return html.includes("</body>")
      ? html.replace("</body>", `${footer}</body>`)
      : html + footer;
  }
}
