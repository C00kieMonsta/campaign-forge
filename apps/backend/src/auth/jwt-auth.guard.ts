import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService } from "@/auth/auth.service";

export const IS_PUBLIC_KEY = "isPublic";
// Fix: Remove the arrow function wrapper - createDecorator already returns a decorator
export const Public = Reflector.createDecorator<boolean>({
  key: IS_PUBLIC_KEY
});

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException("Authentication token is required");
    }

    try {
      const user = await this.authService.verifyJWT(token);
      request.user = user; // Attach user to request
      return true;
    } catch (error) {
      throw new UnauthorizedException("Invalid authentication token");
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}
