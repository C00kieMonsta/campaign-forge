import { Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthenticatedUser } from "@packages/types";
import * as jwt from "jsonwebtoken";
import { ConfigService } from "@/config/config.service";
import { Loggable } from "@/logger/loggable";
import { OrganizationsDatabaseService } from "@/shared/database/services/organizations.database.service";
import { UsersDatabaseService } from "@/shared/database/services/users.database.service";

interface JWTPayload {
  sub: string;
  email?: string;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
  role?: string;
  app_metadata?: any;
  user_metadata?: any;
}

interface CachedUser {
  user: AuthenticatedUser;
  cachedAt: number;
  expiresAt: number;
}

@Injectable()
export class JWTVerificationService extends Loggable {
  private userCache = new Map<string, CachedUser>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
  private supabaseJWTSecret: string;

  constructor(
    private configService: ConfigService,
    private usersDb: UsersDatabaseService,
    private organizationsDb: OrganizationsDatabaseService
  ) {
    super();
    this.supabaseJWTSecret = this.configService.supabase.jwtSecret!;

    // Validate configuration on startup
    this.validateConfiguration();

    // Clean up expired cache entries every 10 minutes
    setInterval(() => this.cleanupCache(), 10 * 60 * 1000);
  }

  private validateConfiguration(): void {
    const supabaseUrl = this.configService.supabase.url;
    const jwtSecret = this.configService.supabase.jwtSecret;

    if (!supabaseUrl || !jwtSecret) {
      throw new Error(
        "Missing required Supabase configuration: SUPABASE_URL and SUPABASE_JWT_SECRET are required"
      );
    }

    // Log configuration for debugging (without sensitive data)
    const expectedIssuer = `${supabaseUrl}/auth/v1`;

    this.logger.info("JWT Verification Service initialized", {
      supabaseUrl,
      expectedIssuer,
      hasJwtSecret: !!jwtSecret,
      environment: process.env.NODE_ENV
    });
  }

  async verifyJWT(token: string): Promise<AuthenticatedUser> {
    // Both local and production Supabase use /auth/v1 in the issuer
    const baseUrl = this.configService.supabase.url;
    const expectedIssuer = `${baseUrl}/auth/v1`;

    try {
      // Check cache first
      const cached = this.userCache.get(token);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.user;
      }

      // Verify JWT locally using Supabase JWT secret
      const tJwtVerify0 = performance.now();

      const payload = jwt.verify(token, this.supabaseJWTSecret, {
        audience: "authenticated",
        issuer: expectedIssuer
      }) as JWTPayload;
      const jwtVerifyTime = +(performance.now() - tJwtVerify0).toFixed(1);

      // Get user's organization membership
      const tDbQuery0 = performance.now();
      let organizationId: string | undefined;
      try {
        const memberships = await this.usersDb.getUserOrganizationMemberships(
          payload.sub
        );

        if (memberships && memberships.length > 0) {
          // Prioritize non-default organizations
          let selectedMembership = memberships[0];

          // Check if any membership is for a non-default organization
          for (const membership of memberships) {
            try {
              const org = await this.organizationsDb.getOrganizationById(
                membership.organizationId
              );
              if (
                org &&
                org.meta &&
                typeof org.meta === "object" &&
                !(org.meta as any).is_default
              ) {
                selectedMembership = membership;
                break;
              }
            } catch (error) {
              // If we can't fetch org, continue with current selection
              this.logger.debug(
                "Could not fetch organization to check default status",
                {
                  organizationId: membership.organizationId,
                  error: error instanceof Error ? error.message : String(error)
                }
              );
            }
          }

          organizationId = selectedMembership.organizationId;
        }
      } catch (orgError) {
        this.logger.error("Failed to get organization membership", {
          userId: payload.sub,
          error: orgError instanceof Error ? orgError.message : String(orgError)
        });
      }
      const dbQueryTime = +(performance.now() - tDbQuery0).toFixed(1);

      const authenticatedUser: AuthenticatedUser = {
        id: payload.sub,
        email: payload.email || "",
        organizationId,
        role: payload.role || "user"
      };

      // Cache the result
      this.userCache.set(token, {
        user: authenticatedUser,
        cachedAt: Date.now(),
        expiresAt: Date.now() + this.CACHE_TTL
      });

      return authenticatedUser;
    } catch (error) {
      // Provide more detailed error information for debugging
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isSignatureError = errorMessage.includes("invalid signature");
      const isIssuerError = errorMessage.includes("issuer");

      // Decode the JWT to see what issuer it actually has (without verifying signature)
      let actualIssuer = "unknown";
      try {
        const payload = JSON.parse(
          Buffer.from(token.split(".")[1], "base64").toString()
        );
        actualIssuer = payload.iss || "missing";
      } catch (decodeError) {
        actualIssuer = "decode-failed";
      }

      this.logger.warn("JWT verification failed", {
        error: errorMessage,
        tokenLength: token.length,
        isSignatureError,
        isIssuerError,
        expectedIssuer: expectedIssuer,
        actualIssuer,
        environment: process.env.NODE_ENV
      });

      // Provide specific guidance for common configuration issues
      if (isSignatureError) {
        this.logger.error(
          "JWT signature verification failed - this usually indicates a mismatch between frontend and backend Supabase configurations",
          {
            hint: "Ensure SUPABASE_URL and SUPABASE_JWT_SECRET match between frontend and backend environments"
          }
        );
      }

      throw new UnauthorizedException("Invalid or expired token");
    }
  }

  private cleanupCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [token, cached] of this.userCache.entries()) {
      if (now >= cached.expiresAt) {
        this.userCache.delete(token);
        cleaned++;
      }
    }
  }

  // Method to clear cache for a specific user (useful for logout/token revocation)
  clearUserCache(userId: string): void {
    let cleared = 0;
    for (const [token, cached] of this.userCache.entries()) {
      if (cached.user.id === userId) {
        this.userCache.delete(token);
        cleared++;
      }
    }
  }
}
