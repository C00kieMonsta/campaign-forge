import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { getAdminAllowlist } from "./env";

export function getClaims(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  return event.requestContext.authorizer.jwt.claims as Record<string, string>;
}

export function isAllowedAdmin(event: APIGatewayProxyEventV2WithJWTAuthorizer): boolean {
  const allowlist = getAdminAllowlist();
  if (allowlist.length === 0) return true;
  const email = getClaims(event).email?.toLowerCase();
  return !!email && allowlist.includes(email);
}
