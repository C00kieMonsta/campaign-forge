import { Controller, Get } from "@nestjs/common";
import { Public } from "@/auth/jwt-auth.guard";

@Controller("health")
export class HealthController {
  @Get()
  @Public()
  checkHealth() {
    return {
      status: "ok",
      timestamp: new Date().toISOString()
    };
  }
}
