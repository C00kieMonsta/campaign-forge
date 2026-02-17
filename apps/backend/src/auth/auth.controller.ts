import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Request
} from "@nestjs/common";
import {
  AuthResponseSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  ROLE_SLUGS,
  type AuthenticatedUser,
  type AuthResponse,
  type LoginRequest,
  type RefreshTokenRequest,
  type RegisterRequest
} from "@packages/types";
import { createClient } from "@supabase/supabase-js";
import { AuthService } from "@/auth/auth.service";
import { Public } from "@/auth/jwt-auth.guard";
import { ConfigService } from "@/config/config.service";
import { Audit } from "@/logger/audit.decorator";
import { PrismaService } from "@/shared/prisma/prisma.service";
import { AuthenticatedRequest } from "@/shared/types/request.types";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService
  ) {}

  private getSupabaseClient() {
    const config = this.configService.getSupabaseConfig();

    if (!config.url || !config.anonKey) {
      throw new Error("Supabase configuration is incomplete");
    }

    return createClient(config.url, config.anonKey);
  }

  @Post("login")
  @Public()
  @Audit({
    action: "login",
    resource: "auth",
    logResult: false // Don't log tokens
  })
  async login(@Body() body: LoginRequest): Promise<AuthResponse> {
    try {
      // Validate request payload
      const loginData = LoginRequestSchema.parse(body);

      const supabase = this.getSupabaseClient();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginData.email,
        password: loginData.password
      });

      if (error || !data.user || !data.session) {
        throw new HttpException(
          {
            error: "Authentication failed",
            message: error?.message || "Invalid credentials"
          },
          HttpStatus.UNAUTHORIZED
        );
      }

      // Get user's organization membership using the auth service
      const authenticatedUser = await this.authService.verifyJWT(
        data.session.access_token
      );

      if (!data.session.expires_at) {
        throw new HttpException(
          {
            error: "Authentication failed",
            message: "No expiration time found"
          },
          HttpStatus.UNAUTHORIZED
        );
      }

      const response: AuthResponse = {
        user: authenticatedUser,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: new Date(data.session.expires_at * 1000).toISOString()
      };

      // Validate response structure
      const validatedResponse = AuthResponseSchema.parse(response);
      return validatedResponse;
    } catch (error) {
      console.error("[auth-controller] login - Authentication failed:", error);
      throw error;
    }
  }

  @Post("register")
  @Public()
  @Audit({
    action: "register",
    resource: "auth",
    logResult: false // Don't log sensitive data
  })
  async register(@Body() body: RegisterRequest): Promise<{ message: string }> {
    // Validate request payload
    const registerData = RegisterRequestSchema.parse(body);

    const supabase = this.getSupabaseClient();

    const { error } = await supabase.auth.signUp({
      email: registerData.email,
      password: registerData.password,
      options: {
        data: {
          first_name: registerData.firstName,
          last_name: registerData.lastName,
          invitation_token: registerData.invitationToken // Store invitation token in user metadata
        }
      }
    });

    if (error) {
      throw new HttpException(
        {
          error: "Registration failed",
          message: error.message
        },
        HttpStatus.BAD_REQUEST
      );
    }

    return {
      message:
        "Registration successful. Please check your email to verify your account."
    };
  }

  @Get("me")
  @Audit({
    action: "get_profile",
    resource: "auth",
    logResult: false
  })
  async getProfile(
    @Request() req: AuthenticatedRequest
  ): Promise<AuthenticatedUser> {
    // The JWT guard already verified the token and attached the user
    if (!req.user) {
      throw new HttpException("User not found", HttpStatus.UNAUTHORIZED);
    }
    return req.user;
  }

  @Post("fix-organization")
  @Audit({
    action: "fix_organization",
    resource: "auth"
  })
  async fixUserOrganization(
    @Request() req: AuthenticatedRequest
  ): Promise<{ message: string; organizationId?: string }> {
    const user = req.user;

    if (!user) {
      throw new HttpException(
        "Authentication required",
        HttpStatus.UNAUTHORIZED
      );
    }

    if (user.organizationId) {
      return {
        message: "User already has organization membership",
        organizationId: user.organizationId
      };
    }

    // Add user to default organization
    const supabase = this.getSupabaseAdminClient();

    try {
      // First, ensure default organization exists
      const defaultOrgId = "550e8400-e29b-41d4-a716-446655440001";
      const defaultRoleId = "550e8400-e29b-41d4-a716-446655440002";

      const { error: memberError } = await supabase
        .from("organization_members")
        .insert({
          organization_id: defaultOrgId,
          user_id: user.id,
          role_id: defaultRoleId,
          status: "active"
        });

      if (memberError && memberError.code !== "23505") {
        // Ignore duplicate key errors
        throw new Error(
          `Failed to add organization membership: ${memberError.message}`
        );
      }

      return {
        message: "User successfully added to default organization",
        organizationId: defaultOrgId
      };
    } catch (error) {
      throw new HttpException(
        `Failed to fix organization membership: ${error instanceof Error ? error.message : "Unknown error"}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private getSupabaseAdminClient() {
    const config = this.configService.getSupabaseConfig();

    if (!config.url || !config.serviceRoleKey) {
      throw new Error("Supabase configuration is incomplete");
    }

    return createClient(config.url, config.serviceRoleKey);
  }

  @Post("refresh")
  @Public()
  @Audit({
    action: "refresh_token",
    resource: "auth",
    logResult: false
  })
  async refreshToken(@Body() body: RefreshTokenRequest): Promise<AuthResponse> {
    const supabase = this.getSupabaseClient();

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: body.refreshToken
    });

    if (error || !data.user || !data.session) {
      throw new HttpException(
        {
          error: "Token refresh failed",
          message: error?.message || "Invalid refresh token"
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (!data.user.email) {
      throw new HttpException(
        {
          error: "Token refresh failed",
          message: "User email not found"
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (!data.session.expires_at) {
      throw new HttpException(
        {
          error: "Token refresh failed",
          message: "No expiration time found"
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    const response: AuthResponse = {
      user: {
        id: data.user.id,
        email: data.user.email,
        role: data.user.user_metadata?.role || ROLE_SLUGS.MEMBER
      },
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: new Date(data.session.expires_at * 1000).toISOString()
    };

    return AuthResponseSchema.parse(response);
  }

  @Get("admin-access")
  @Audit({
    action: "check_admin_access",
    resource: "auth",
    logResult: false
  })
  async checkAdminAccess(@Request() req: AuthenticatedRequest): Promise<{
    hasAdminAccess: boolean;
    role?: {
      slug: string;
      name: string;
      isSystem: boolean;
    };
    organizationId?: string;
  }> {
    const user = req.user;

    if (!user || !user.organizationId) {
      return { hasAdminAccess: false };
    }

    const prisma = this.prismaService.client;

    try {
      const membership = await prisma.organizationMember.findFirst({
        where: {
          userId: user.id,
          organizationId: user.organizationId,
          status: "active"
        },
        include: {
          role: {
            select: {
              slug: true,
              name: true,
              isSystem: true
            }
          }
        }
      });

      if (!membership || !membership.role) {
        return { hasAdminAccess: false };
      }

      const hasAdminAccess = membership.role.slug === ROLE_SLUGS.ADMIN;

      return {
        hasAdminAccess,
        role: membership.role,
        organizationId: user.organizationId
      };
    } catch (error) {
      console.error("Failed to check admin access:", error);
      // On error, default to no access for security
      return { hasAdminAccess: false };
    }
  }
}
