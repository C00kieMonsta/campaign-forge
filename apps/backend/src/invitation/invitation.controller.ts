import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query
} from "@nestjs/common";
import {
  TABLE_NAMES,
  type InvitationValidationResponse
} from "@packages/types";
import { Public } from "@/auth/jwt-auth.guard";
import { InvitationService } from "@/invitation/invitation.service";
import { Audit } from "@/logger/audit.decorator";

@Controller(TABLE_NAMES.INVITATIONS)
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  /**
   * Validate an invitation token and email
   * This endpoint is public as it's used before user registration
   */
  @Get("validate/:token")
  @Public()
  @Audit({
    action: "validate_invitation",
    resource: "invitation",
    logResult: false // Don't log the full result for privacy
  })
  async validateInvitation(
    @Param("token") token: string,
    @Query("email") email: string
  ): Promise<InvitationValidationResponse> {
    // Basic token format validation (base64url should be at least 32 chars)
    if (!token || token.length < 32) {
      throw new HttpException(
        {
          valid: false,
          message: "Invalid invitation token format"
        },
        HttpStatus.BAD_REQUEST
      );
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      throw new HttpException(
        {
          valid: false,
          message: "Valid email is required"
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const invitation = await this.invitationService.validateInvitation(
      token,
      email
    );

    if (!invitation) {
      return {
        valid: false,
        error: "Invalid or expired invitation"
      };
    }

    return {
      valid: true,
      invitation: invitation
    };
  }
}
