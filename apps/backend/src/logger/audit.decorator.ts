import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata
} from "@nestjs/common";
import { AuditLogger } from "@/logger/audit-logger.service";

export const AUDIT_METADATA_KEY = "audit";

export interface AuditOptions {
  action: string;
  resource?: string;
  logParams?: boolean;
  logResult?: boolean;
  sensitive?: string[]; // List of parameter names to redact
}

/**
 * Decorator to mark methods for audit logging
 */
export const Audit = (options: AuditOptions) =>
  SetMetadata(AUDIT_METADATA_KEY, options);

/**
 * Parameter decorator to inject the audit logger
 */
export const AuditLog = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuditLogger => {
    try {
      const request = ctx.switchToHttp()?.getRequest();
      if (!request || !request.auditLogger) {
        // Create a simple logger if audit logger is not available (e.g., in tests)
        return {
          auditDataAccess: () => {},
          info: () => {},
          error: () => {},
          warn: () => {},
          debug: () => {},
          auditLog: () => {},
          auditSecurity: () => {},
          setCorrelationId: () => {},
          setRequestContext: () => {},
          setActionContext: () => {}
        } as any;
      }
      return request.auditLogger;
    } catch (error) {
      // Fallback logger if there's any error accessing the request
      return {
        auditDataAccess: () => {},
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
        auditLog: () => {},
        auditSecurity: () => {},
        setCorrelationId: () => {},
        setRequestContext: () => {},
        setActionContext: () => {}
      } as any;
    }
  }
);

/**
 * Helper function to redact sensitive information from objects
 */
export function redactSensitiveData(
  data: any,
  sensitiveFields: string[] = []
): any {
  if (!data || typeof data !== "object") {
    return data;
  }

  const defaultSensitive = [
    "password",
    "token",
    "secret",
    "key",
    "authorization"
  ];
  const allSensitive = [...defaultSensitive, ...sensitiveFields];

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item, sensitiveFields));
  }

  const redacted = { ...data };
  for (const key of Object.keys(redacted)) {
    if (
      allSensitive.some((sensitive) =>
        key.toLowerCase().includes(sensitive.toLowerCase())
      )
    ) {
      redacted[key] = "[REDACTED]";
    } else if (typeof redacted[key] === "object" && redacted[key] !== null) {
      redacted[key] = redactSensitiveData(redacted[key], sensitiveFields);
    }
  }

  return redacted;
}
