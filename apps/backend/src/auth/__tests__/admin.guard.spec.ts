import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { sign } from "jsonwebtoken";
import type { ConfigService } from "../../config/config.service";
import { AdminGuard, type AuthedRequest } from "../admin.guard";

/**
 * Two kinds of token share one secret: the 8 h session and the 2 min snapshot download ticket.
 * What matters is that neither is accepted where the other is expected.
 */

const SECRET = "s".repeat(40);

function makeGuard(): AdminGuard {
  const env: Record<string, string> = {
    JWT_SECRET: SECRET,
    ADMIN_CREDENTIALS: JSON.stringify([
      { email: "Admin@Example.com", hash: "irrelevant" }
    ])
  };
  return new AdminGuard({
    get: (k: string) => env[k]
  } as unknown as ConfigService);
}

const session = () => sign({ email: "admin@example.com" }, SECRET);
const ticket = () =>
  sign({ email: "admin@example.com", purpose: "snapshot-download" }, SECRET);

describe("AdminGuard.verifyToken", () => {
  it("accepts a session token and lowercases the email", () => {
    expect(makeGuard().verifyToken(session())).toEqual({
      email: "admin@example.com"
    });
  });

  it("refuses a download ticket as a session", () => {
    expect(() => makeGuard().verifyToken(ticket())).toThrow(
      UnauthorizedException
    );
  });

  it("accepts a download ticket where that purpose is expected", () => {
    expect(
      makeGuard().verifyToken(ticket(), { purpose: "snapshot-download" })
    ).toEqual({ email: "admin@example.com" });
  });

  it("refuses a session token where a download ticket is expected", () => {
    expect(() =>
      makeGuard().verifyToken(session(), { purpose: "snapshot-download" })
    ).toThrow(UnauthorizedException);
  });

  it("refuses a well-signed token for an email that is not a provisioned admin", () => {
    const stranger = sign({ email: "someone@else.com" }, SECRET);
    expect(() => makeGuard().verifyToken(stranger)).toThrow(
      UnauthorizedException
    );
  });

  it("refuses a token signed with another secret", () => {
    const forged = sign({ email: "admin@example.com" }, "x".repeat(40));
    expect(() => makeGuard().verifyToken(forged)).toThrow(
      UnauthorizedException
    );
  });
});

describe("AdminGuard.canActivate", () => {
  it("attaches the admin to the request", () => {
    const req = {
      headers: { authorization: `Bearer ${session()}` }
    } as unknown as AuthedRequest;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req })
    } as unknown as ExecutionContext;
    expect(makeGuard().canActivate(ctx)).toBe(true);
    expect(req.user).toEqual({ email: "admin@example.com" });
  });

  it("rejects a request without a bearer header", () => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) })
    } as unknown as ExecutionContext;
    expect(() => makeGuard().canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
