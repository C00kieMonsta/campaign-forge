import { Injectable } from "@nestjs/common";
import { AuthenticatedUser, User } from "@packages/types";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { JWTVerificationService } from "@/auth/jwt-verification.service";
import { ConfigService } from "@/config/config.service";
import { Loggable } from "@/logger/loggable";
import { OrganizationService } from "@/organization/organization.service";
import { UsersDatabaseService } from "@/shared/database/services/users.database.service";

@Injectable()
export class AuthService extends Loggable {
  private supabaseAdmin!: SupabaseClient;

  constructor(
    private configService: ConfigService,
    private usersDb: UsersDatabaseService,
    private jwtVerificationService: JWTVerificationService,
    private organizationService: OrganizationService
  ) {
    super();
    this.initializeClients();
  }

  private initializeClients() {
    const config = this.configService.getSupabaseConfig();

    if (!config.url || !config.serviceRoleKey || !config.anonKey) {
      throw new Error("Supabase configuration is incomplete");
    }

    // Admin client for server-side operations
    this.supabaseAdmin = createClient(config.url, config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Client for JWT verification
    this.supabaseClient = createClient(config.url, config.anonKey);
  }

  async verifyJWT(token: string): Promise<AuthenticatedUser> {
    // Use the new JWT verification service for better performance
    const user = await this.jwtVerificationService.verifyJWT(token);

    // Get the full auth user data to check for invitation token
    try {
      const { data: authUser } = await this.supabaseAdmin.auth.getUser(token);
      if (authUser?.user) {
        const invitationToken = authUser.user.user_metadata?.invitation_token;
        await this.ensureUserProfileExists(authUser.user, invitationToken);
      }
    } catch (error) {
      this.logger.error("Failed to ensure user profile or handle invitation", {
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - we don't want to block authentication
    }

    return user;
  }

  // For server-side operations using service role
  getAdminClient(): SupabaseClient {
    return this.supabaseAdmin;
  }

  /**
   * Ensures that a user profile exists in our database for the authenticated Supabase user.
   * Creates the profile if it doesn't exist using the Supabase auth user data.
   * Also handles invitation acceptance if the user was invited.
   */
  async ensureUserProfileExists(
    authUser: any,
    invitationToken?: string
  ): Promise<void> {
    try {
      // Check if user already exists in our database
      const existingUser = await this.usersDb.getUserById(authUser.id);

      if (existingUser) {
        return;
      }

      // User doesn't exist, create profile from auth user data
      const userProfileData: User = {
        id: authUser.id,
        email: authUser.email,
        firstName: authUser.user_metadata?.first_name || "",
        lastName: authUser.user_metadata?.last_name || "",
        avatarUrl: authUser.user_metadata?.avatar_url || undefined,
        phone: authUser.user_metadata?.phone || undefined,
        timezone: "UTC",
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await this.usersDb.createUserWithId(userProfileData);

      // Handle invitation acceptance if invitation token is provided
      if (invitationToken) {
        try {
          await this.organizationService.acceptInvitation(
            invitationToken,
            authUser.id
          );
        } catch (invitationError) {}
      }
    } catch (error) {}
  }
}
