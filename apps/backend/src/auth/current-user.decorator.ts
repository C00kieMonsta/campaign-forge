import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException
} from "@nestjs/common";
import type { AuthedRequest, AuthUser } from "./admin.guard";

/**
 * Injects the authenticated {@link AuthUser} populated by {@link AdminGuard}.
 * Must only be used on routes protected by `@UseGuards(AdminGuard)`.
 *
 *   @Get()
 *   list(@CurrentUser() user: AuthUser) { ... user.email ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw new UnauthorizedException("Not authenticated");
    return req.user;
  }
);
