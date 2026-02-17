import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor
} from "@nestjs/common";
import { Request, Response } from "express";
import { Observable } from "rxjs";
import { catchError, tap } from "rxjs/operators";
import { v4 as uuidv4 } from "uuid";

// Extend Express Request interface to include requestId and user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
      user?: {
        id: string;
        organizationId?: string;
      };
    }
  }
}

/**
 * Global logging interceptor for structured request/response logging
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Generate request ID for tracing
    const requestId = uuidv4();
    request.requestId = requestId;
    response.setHeader("X-Request-ID", requestId);

    const { method, url, ip, headers } = request;
    const userAgent = headers["user-agent"] || "";
    const userId = request.user?.id || "anonymous";
    const organizationId = request.user?.organizationId || null;

    const startTime = Date.now();

    // Log incoming request - concise format for INFO level
    this.logger.log(
      `Incoming ${method} ${url} [${requestId}] - User: ${userId}`
    );

    return next.handle().pipe(
      tap((data) => {
        const duration = Date.now() - startTime;
        const { statusCode } = response;

        // Log successful response - concise format for INFO level
        const responseSize = JSON.stringify(data || {}).length;
        this.logger.log(
          `${method} ${url} - ${statusCode} - ${duration}ms - ${responseSize}b [${requestId}]`
        );
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        const statusCode = error.status || 500;

        // Log error response - detailed object for ERROR level
        this.logger.error(
          `${method} ${url} - ${statusCode} - ${duration}ms - ERROR`,
          {
            requestId,
            method,
            url,
            statusCode,
            duration,
            userId,
            organizationId,
            ip,
            userAgent,
            error: {
              message: error.message,
              stack: error.stack,
              name: error.name
            },
            timestamp: new Date().toISOString()
          }
        );

        throw error;
      })
    );
  }
}
