import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
import { Response } from "express";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

/**
 * Cache control interceptor to add appropriate cache headers to GET requests
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse<Response>();

    // Only apply caching to GET requests
    if (request.method === "GET") {
      const url = request.url;

      // Set cache headers based on endpoint patterns
      if (this.shouldCacheShort(url)) {
        // Short cache for frequently changing data (30 seconds)
        response.set(
          "Cache-Control",
          "public, s-maxage=30, stale-while-revalidate=300"
        );
      } else if (this.shouldCacheMedium(url)) {
        // Medium cache for semi-static data (5 minutes)
        response.set(
          "Cache-Control",
          "public, s-maxage=300, stale-while-revalidate=600"
        );
      } else if (this.shouldCacheLong(url)) {
        // Long cache for static data (1 hour)
        response.set(
          "Cache-Control",
          "public, s-maxage=3600, stale-while-revalidate=7200"
        );
      } else {
        // No cache for dynamic/user-specific data
        response.set(
          "Cache-Control",
          "private, no-cache, no-store, must-revalidate"
        );
      }

      // Add ETag support for better caching
      response.set("Vary", "Authorization");
    }

    return next.handle().pipe(
      map((data) => {
        return data;
      })
    );
  }

  /**
   * Short cache (30s) - frequently changing data
   */
  private shouldCacheShort(url: string): boolean {
    return (
      (url.includes("/extraction/job/") && !url.includes("/results")) ||
      url.includes("/files/project/") ||
      url.includes("/extraction/project/")
    );
  }

  /**
   * Medium cache (5min) - semi-static data
   */
  private shouldCacheMedium(url: string): boolean {
    return (
      (url.includes("/projects") && !url.includes("/files")) ||
      url.includes("/clients") ||
      url.includes("/organizations")
    );
  }

  /**
   * Long cache (1hr) - static data
   */
  private shouldCacheLong(url: string): boolean {
    return (
      url.includes("/health") ||
      (url.includes("/extraction/job/") && url.includes("/results"))
    );
  }
}
