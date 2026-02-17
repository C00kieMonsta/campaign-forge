import { Controller, Get, Req } from "@nestjs/common";
import { ProtectedDataResponse } from "@packages/types";
import { AppService } from "@/app.service";
import { Public } from "@/auth/jwt-auth.guard";
import { ConfigService } from "@/config/config.service";
import { AuditLogger } from "@/logger/audit-logger.service";
import { Audit, AuditLog } from "@/logger/audit.decorator";

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly configService: ConfigService
  ) {}

  @Get("env-check")
  @Public()
  @Audit({
    action: "env_check",
    resource: "environment",
    logResult: true
  })
  checkEnvironment(@AuditLog() auditLogger: AuditLogger): any {
    auditLogger.auditDataAccess("environment_config", undefined, "read");

    // Check if API keys are configured (without exposing the actual keys)
    const openaiConfig = this.configService.getOpenAI();
    const anthropicConfig = this.configService.getAnthropicAPIKey();
    const geminiConfig = this.configService.getGeminiAISecret();
    const supabaseConfig = this.configService.getSupabaseConfig();

    // Helper function to check if API key is a placeholder
    const isPlaceholder = (key: string): boolean => {
      if (!key) return false;
      const placeholderPatterns = [
        "your-openai-api-key",
        "your-anthropic-api-key",
        "your-gemini-api-key"
      ];
      return placeholderPatterns.some((pattern) => key.includes(pattern));
    };

    const openaiKey = openaiConfig?.api_key || "";
    const anthropicKey = anthropicConfig?.api_key || "";
    const geminiKey = geminiConfig?.api_key || "";

    return {
      environment:
        (process.env.NODE_ENV as "development" | "production" | "test") ||
        "development",
      port: process.env.PORT || "8001",
      logLevel: process.env.LOG_LEVEL || "info",
      apiKeys: {
        openai: {
          configured: !!openaiKey && !isPlaceholder(openaiKey),
          hasValue: !!openaiKey,
          isPlaceholder: isPlaceholder(openaiKey)
        },
        anthropic: {
          configured: !!anthropicKey && !isPlaceholder(anthropicKey),
          hasValue: !!anthropicKey,
          isPlaceholder: isPlaceholder(anthropicKey)
        },
        gemini: {
          configured: !!geminiKey && !isPlaceholder(geminiKey),
          hasValue: !!geminiKey,
          isPlaceholder: isPlaceholder(geminiKey)
        },
        supabase: {
          urlConfigured: !!supabaseConfig.url,
          serviceKeyConfigured: !!supabaseConfig.serviceRoleKey
        }
      },
      supabaseConfigured:
        !!supabaseConfig.url && !!supabaseConfig.serviceRoleKey,
      llmConfigured:
        (!!anthropicKey && !isPlaceholder(anthropicKey)) ||
        (!!geminiKey && !isPlaceholder(geminiKey)),
      emailConfigured: false, // TODO: Add email configuration check
      version: process.env.npm_package_version || "0.0.1",
      timestamp: new Date().toISOString()
    };
  }

  // Example of protected endpoint
  @Get("protected")
  @Audit({
    action: "protected_access",
    resource: "protected_data",
    logResult: true
  })
  getProtectedData(
    @Req() req: any,
    @AuditLog() auditLogger: AuditLogger
  ): ProtectedDataResponse {
    // req.user will contain the authenticated user info
    auditLogger.auditDataAccess("protected_data", req.user.id, "read");

    return {
      message: "This is protected data",
      user: req.user,
      timestamp: new Date().toISOString()
    };
  }
}
