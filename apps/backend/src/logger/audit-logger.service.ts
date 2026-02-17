import { randomUUID } from "crypto";
import { Injectable, Scope } from "@nestjs/common";
import { createLogger, format, Logger, transports } from "winston";

export interface AuditContext {
  correlationId?: string;
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  organizationId?: string;
  plantId?: string;
  [key: string]: any;
}

export interface LogEntry {
  level: "error" | "warn" | "info" | "debug" | "verbose";
  message: string;
  timestamp: string;
  correlationId: string;
  context?: AuditContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, any>;
}

@Injectable({ scope: Scope.REQUEST })
export class AuditLogger {
  private readonly logger: Logger;
  private context: AuditContext = {};

  constructor() {
    // Filter to suppress debug logs in production
    const suppressDebugLogs = format((info) => {
      const currentLogLevel = process.env.LOG_LEVEL || "info";

      // In info/warn mode, suppress debug logs
      if (currentLogLevel === "info" || currentLogLevel === "warn") {
        if (info.level === "debug") {
          return false;
        }
      }

      return info;
    })();

    this.logger = createLogger({
      level: process.env.LOG_LEVEL || "info",
      format: format.combine(
        suppressDebugLogs,
        format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
        format.errors({ stack: true }),
        format.json(),
        format.printf((info) => {
          const logEntry: LogEntry = {
            level: info.level as LogEntry["level"],
            message: info.message as string,
            timestamp: info.timestamp as string,
            correlationId: this.context.correlationId || "unknown",
            context: this.context,
            metadata: info.metadata as Record<string, any> | undefined
          };

          if (info.error && typeof info.error === "object") {
            const error = info.error as Error;
            logEntry.error = {
              name: error.name,
              message: error.message,
              stack: error.stack
            };
          }

          return JSON.stringify(logEntry);
        })
      ),
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.printf((info) => {
              const prefix = `[${info.timestamp}] [${info.level}] [${this.context.correlationId || "unknown"}]`;
              const contextStr = this.context.userId
                ? ` [User: ${this.context.userId}]`
                : "";
              const actionStr = this.context.action
                ? ` [Action: ${this.context.action}]`
                : "";

              return `${prefix}${contextStr}${actionStr} ${info.message}`;
            })
          )
        }),
        // File transport for structured logs
        new transports.File({
          filename: "logs/audit.log",
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
          tailable: true
        }),
        // Error-specific log file
        new transports.File({
          filename: "logs/error.log",
          level: "error",
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
          tailable: true
        })
      ]
    });
  }

  /**
   * Set the correlation ID for this request
   */
  setCorrelationId(correlationId?: string): string {
    const id = correlationId || randomUUID();
    this.context.correlationId = id;
    return id;
  }

  /**
   * Set user context for audit logging
   */
  setUserContext(userId: string, userEmail?: string, sessionId?: string): void {
    this.context.userId = userId;
    this.context.userEmail = userEmail;
    this.context.sessionId = sessionId;
  }

  /**
   * Set request context
   */
  setRequestContext(ipAddress?: string, userAgent?: string): void {
    this.context.ipAddress = ipAddress;
    this.context.userAgent = userAgent;
  }

  /**
   * Set organization context
   */
  setOrganizationContext(organizationId?: string, plantId?: string): void {
    this.context.organizationId = organizationId;
    this.context.plantId = plantId;
  }

  /**
   * Set action context for audit trail
   */
  setActionContext(
    action: string,
    resource?: string,
    resourceId?: string
  ): void {
    this.context.action = action;
    this.context.resource = resource;
    this.context.resourceId = resourceId;
  }

  /**
   * Get current context
   */
  getContext(): AuditContext {
    return { ...this.context };
  }

  /**
   * Log an audit event with full context
   */
  auditLog(
    level: LogEntry["level"],
    message: string,
    metadata?: Record<string, any>
  ): void {
    this.logger.log(level, message, { metadata });
  }

  /**
   * Log user action for audit trail
   */
  auditAction(
    action: string,
    resource?: string,
    resourceId?: string,
    metadata?: Record<string, any>
  ): void {
    this.setActionContext(action, resource, resourceId);
    this.auditLog("info", `User action: ${action}`, {
      resource,
      resourceId,
      ...metadata
    });
  }

  /**
   * Log data access for compliance
   */
  auditDataAccess(
    resource: string,
    resourceId?: string,
    operation: "read" | "write" | "delete" = "read"
  ): void {
    this.auditLog("info", `Data ${operation}: ${resource}`, {
      resource,
      resourceId,
      operation
    });
  }

  /**
   * Log authentication events
   */
  auditAuth(
    event:
      | "login"
      | "logout"
      | "failed_login"
      | "password_change"
      | "session_expired",
    metadata?: Record<string, any>
  ): void {
    this.auditLog("info", `Authentication event: ${event}`, {
      authEvent: event,
      ...metadata
    });
  }

  /**
   * Log security events
   */
  auditSecurity(
    event: string,
    severity: "low" | "medium" | "high" | "critical",
    metadata?: Record<string, any>
  ): void {
    this.auditLog("warn", `Security event: ${event}`, {
      securityEvent: event,
      severity,
      ...metadata
    });
  }

  /**
   * Standard logging methods with audit context
   */
  error(message: string, error?: Error, metadata?: Record<string, any>): void {
    this.logger.error(message, { error, metadata });
  }

  warn(message: string, metadata?: Record<string, any>): void {
    this.logger.warn(message, { metadata });
  }

  info(message: string, metadata?: Record<string, any>): void {
    this.logger.info(message, { metadata });
  }

  debug(message: string, metadata?: Record<string, any>): void {
    this.logger.debug(message, { metadata });
  }

  verbose(message: string, metadata?: Record<string, any>): void {
    this.logger.verbose(message, { metadata });
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: Partial<AuditContext>): AuditLogger {
    const childLogger = new AuditLogger();
    childLogger.context = { ...this.context, ...additionalContext };
    return childLogger;
  }
}
