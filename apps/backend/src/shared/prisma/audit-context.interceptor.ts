import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
import { Observable } from "rxjs";
import {
  auditContextStorage,
  extractAuditContextFromRequest
} from "./audit-context.provider";

/**
 * Interceptor to capture and store audit context from incoming requests
 * Runs AFTER guards (including JWT authentication) so user context is available
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Extract audit context from the request (user should be available now)
    const auditContext = extractAuditContextFromRequest(request);

    // Run the rest of the request processing with audit context
    return new Observable((subscriber) => {
      auditContextStorage.run(auditContext, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete()
        });
      });
    });
  }
}
