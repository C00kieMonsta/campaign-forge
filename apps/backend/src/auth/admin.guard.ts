import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type { Request } from "express";
import { verify } from "jsonwebtoken";
import { z } from "zod";
import { ConfigService } from "../config/config.service";

const credentialsSchema = z.array(
  z.object({ email: z.string(), hash: z.string() })
);

/** The authenticated principal, attached to the request by AdminGuard. */
export interface AuthUser {
  email: string;
}

/** Express request enriched with the authenticated user. */
export type AuthedRequest = Request & { user?: AuthUser };

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer "))
      throw new UnauthorizedException("Missing token");

    const token = authHeader.slice(7);
    let payload: unknown;
    try {
      payload = verify(token, this.config.get("JWT_SECRET"));
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    const email = this.extractEmail(payload);
    if (!email) throw new UnauthorizedException("Invalid token payload");

    // Defence in depth: a validly-signed token must still belong to a provisioned admin.
    // (Tokens are only ever issued to admins in ADMIN_CREDENTIALS, so this rejects nothing
    // legitimate — it just closes the gap for a token whose admin was later removed.)
    if (!this.isKnownAdmin(email))
      throw new UnauthorizedException("Unknown admin");

    // Expose identity so per-user Lex resources can be scoped via @CurrentUser().
    req.user = { email: email.toLowerCase() };
    return true;
  }

  private extractEmail(payload: unknown): string | undefined {
    if (typeof payload !== "object" || payload === null) return undefined;
    const email = (payload as { email?: unknown }).email;
    return typeof email === "string" && email.length > 0 ? email : undefined;
  }

  private isKnownAdmin(email: string): boolean {
    try {
      const credentials = credentialsSchema.parse(
        JSON.parse(this.config.get("ADMIN_CREDENTIALS"))
      );
      return credentials.some(
        (c) => c.email.toLowerCase() === email.toLowerCase()
      );
    } catch {
      // Fail closed. (ADMIN_CREDENTIALS is required and already parsed at login, so a
      // parse failure here would also have blocked login — no new lockout surface.)
      return false;
    }
  }
}
