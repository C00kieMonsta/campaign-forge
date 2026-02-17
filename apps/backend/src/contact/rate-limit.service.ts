import { Injectable, Logger } from "@nestjs/common";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly limits = new Map<string, RateLimitEntry>();
  private readonly MAX_REQUESTS = 5; // 5 requests per window
  private readonly WINDOW_DURATION = 3600000; // 1 hour in milliseconds

  constructor() {
    // Clean up expired entries every 10 minutes
    setInterval(() => this.cleanup(), 600000);
  }

  async checkLimit(clientIp: string): Promise<boolean> {
    const now = Date.now();
    const entry = this.limits.get(clientIp);

    // If no entry exists, create one
    if (!entry) {
      this.limits.set(clientIp, {
        count: 1,
        resetTime: now + this.WINDOW_DURATION,
      });
      return false;
    }

    // If window has expired, reset
    if (now >= entry.resetTime) {
      this.limits.set(clientIp, {
        count: 1,
        resetTime: now + this.WINDOW_DURATION,
      });
      return false;
    }

    // Check if limit exceeded
    if (entry.count >= this.MAX_REQUESTS) {
      return true;
    }

    // Increment count
    entry.count++;
    return false;
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [ip, entry] of this.limits.entries()) {
      if (now >= entry.resetTime) {
        this.limits.delete(ip);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(
        JSON.stringify({
          action: "rate_limit_cleanup",
          removed,
          remaining: this.limits.size,
        })
      );
    }
  }
}
