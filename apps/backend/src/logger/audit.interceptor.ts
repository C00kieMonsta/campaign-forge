import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Scope
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, throwError } from "rxjs";
import { catchError, tap } from "rxjs/operators";
import { AuditLogger } from "@/logger/audit-logger.service";
import {
  AUDIT_METADATA_KEY,
  AuditOptions,
  redactSensitiveData
} from "@/logger/audit.decorator";

@Injectable({ scope: Scope.REQUEST })
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogger: AuditLogger
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditOptions = this.reflector.get<AuditOptions>(
      AUDIT_METADATA_KEY,
      context.getHandler()
    );

    // If no audit options, just proceed without any logging
    if (!auditOptions) {
      return next.handle();
    }

    const className = context.getClass().name;
    const methodName = context.getHandler().name;
    const startTime = Date.now();

    // If no audit logger is available, just proceed
    if (!this.auditLogger) {
      return next.handle();
    }

    // Safely extract request information
    let requestInfo = {};
    try {
      const request = context.switchToHttp()?.getRequest();
      if (request && typeof request === "object") {
        requestInfo = {
          method: request.method || "unknown",
          url: request.url || "unknown",
          ip: request.ip || request.connection?.remoteAddress || "unknown"
        };
      }
    } catch (error) {
      // Silently ignore request extraction errors
      console.warn("Failed to extract request info:", error);
    }

    // Don't log method start - too verbose

    return next.handle().pipe(
      tap((result) => {
        const executionTime = Date.now() - startTime;

        // Don't log action completion - not helpful in production or development
      }),
      catchError((error) => {
        const executionTime = Date.now() - startTime;

        // Log error
        this.auditLogger.error(`Action failed: ${auditOptions.action}`, error, {
          className,
          methodName,
          executionTime: `${executionTime}ms`
        });

        return throwError(() => error);
      })
    );
  }
}
