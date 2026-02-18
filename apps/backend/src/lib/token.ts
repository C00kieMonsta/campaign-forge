import { createHmac, timingSafeEqual } from "crypto";
import { getEnv } from "./env";

const TTL_MS = 365 * 24 * 60 * 60 * 1000;

export function sign(emailLower: string, ttlMs = TTL_MS): string {
  const payload = `${emailLower}|${Date.now() + ttlMs}`;
  const sig = createHmac("sha256", getEnv().UNSUBSCRIBE_SECRET).update(payload).digest("base64url");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verify(token: string): { valid: true; emailLower: string } | { valid: false; error: string } {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const dotIdx = decoded.lastIndexOf(".");
    if (dotIdx === -1) return { valid: false, error: "invalid_format" };

    const payload = decoded.slice(0, dotIdx);
    const sig = decoded.slice(dotIdx + 1);
    const expected = createHmac("sha256", getEnv().UNSUBSCRIBE_SECRET).update(payload).digest("base64url");

    const sigBuf = new Uint8Array(Buffer.from(sig));
    const expBuf = new Uint8Array(Buffer.from(expected));
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: "invalid_signature" };
    }

    const pipeIdx = payload.lastIndexOf("|");
    if (pipeIdx === -1) return { valid: false, error: "invalid_format" };

    const expiry = parseInt(payload.slice(pipeIdx + 1), 10);
    if (isNaN(expiry) || Date.now() > expiry) return { valid: false, error: "expired" };

    return { valid: true, emailLower: payload.slice(0, pipeIdx) };
  } catch {
    return { valid: false, error: "invalid_format" };
  }
}

export function unsubscribeUrl(emailLower: string): string {
  return `${getEnv().PUBLIC_BASE_URL}/unsubscribe?token=${encodeURIComponent(sign(emailLower))}`;
}
