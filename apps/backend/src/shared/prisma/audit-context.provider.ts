import { AsyncLocalStorage } from "async_hooks";
import { AuthenticatedUser, AuditContext } from "@packages/types";
import { AuthenticatedRequest } from "@/shared/types/request.types";

/**
 * Global async context storage for audit information
 * This allows us to capture request context throughout the request lifecycle
 */
export const auditContextStorage = new AsyncLocalStorage<AuditContext>();

/**
 * Get the current audit context from async local storage
 */
export function getCurrentAuditContext(): AuditContext {
  return auditContextStorage.getStore() ?? {};
}

/**
 * Set the audit context for the current async execution context
 */
export function setAuditContext(context: AuditContext): void {
  const store = auditContextStorage.getStore();
  if (store) {
    // Merge with existing context
    Object.assign(store, context);
  }
}

/**
 * Run a function with audit context
 */
export function runWithAuditContext<T>(context: AuditContext, fn: () => T): T {
  return auditContextStorage.run(context, fn);
}

/**
 * Extract audit context from request object
 */
export function extractAuditContextFromRequest(req: AuthenticatedRequest): AuditContext {
  const user = req.user;

  return {
    user,
    correlationId: (req as any).correlationId,
    ipAddress:
      req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress,
    userAgent: req.headers?.["user-agent"] || req.get?.("User-Agent")
  };
}
