import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

/**
 * Global interceptor to handle BigInt serialization and other JSON serialization issues
 */
@Injectable()
export class JsonSerializerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(JsonSerializerInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        try {
          return this.sanitizeForJson(data);
        } catch (error) {
          this.logger.error(
            `JSON serialization failed: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined
          );
          // Return original data and let Express handle the error
          return data;
        }
      })
    );
  }

  /**
   * Deep walk object and sanitize values that can't be JSON serialized
   */
  private sanitizeForJson(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Handle BigInt
    if (typeof obj === "bigint") {
      return obj.toString();
    }

    // Handle Date objects - ensure they're properly serialized
    if (obj instanceof Date) {
      return obj.toISOString();
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeForJson(item));
    }

    // Handle plain objects
    if (typeof obj === "object" && obj.constructor === Object) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = this.sanitizeForJson(value);
      }
      return sanitized;
    }

    // Handle other object types (preserve but sanitize nested properties)
    if (typeof obj === "object") {
      const sanitized = { ...obj };
      for (const [key, value] of Object.entries(sanitized)) {
        sanitized[key] = this.sanitizeForJson(value);
      }
      return sanitized;
    }

    // Return primitive values as-is
    return obj;
  }
}
