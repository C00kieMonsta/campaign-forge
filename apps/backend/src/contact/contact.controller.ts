import {
  Body,
  Controller,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req
} from "@nestjs/common";
import { Public } from "@/auth/jwt-auth.guard";
import { ContactService } from "./contact.service";
import { RateLimitService } from "./rate-limit.service";

export interface SubmitContactRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

@Controller("contact")
export class ContactController {
  private readonly logger = new Logger(ContactController.name);
  private readonly allowedOrigins = [
    "https://remorai.solutions",
    "https://landing.remorai.solutions",
    "https://www.remorai.solutions",
    "http://localhost:3000",
    "http://localhost:3002"
  ];

  constructor(
    private readonly contactService: ContactService,
    private readonly rateLimitService: RateLimitService
  ) {}

  @Post("submit-demo-request")
  @Public()
  async submitDemoRequest(
    @Body() request: SubmitContactRequest,
    @Req() req: any
  ) {
    // Validate origin
    const origin = req.get("origin");
    if (!this.allowedOrigins.includes(origin)) {
      this.logger.warn(
        JSON.stringify({
          action: "contact_form_rejected",
          reason: "invalid_origin",
          origin
        })
      );
      throw new ForbiddenException("Origin not allowed");
    }

    // Rate limiting
    const clientIp = this.getClientIp(req);
    const isRateLimited = await this.rateLimitService.checkLimit(clientIp);
    if (isRateLimited) {
      this.logger.warn(
        JSON.stringify({
          action: "contact_form_rate_limited",
          clientIp
        })
      );
      throw new HttpException(
        "Too many requests",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    this.logger.log(
      JSON.stringify({
        action: "submit_demo_request",
        firstName: request.firstName,
        email: request.email,
        phone: request.phone,
        clientIp
      })
    );

    return this.contactService.submitDemoRequest(request);
  }

  private getClientIp(req: any): string {
    return (
      req.ip ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      req.connection.socket?.remoteAddress ||
      "unknown"
    );
  }
}
