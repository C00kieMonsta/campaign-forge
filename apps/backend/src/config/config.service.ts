import { Injectable } from "@nestjs/common";
import { Env } from "@/config/env";

@Injectable()
export class ConfigService {
  constructor() {}

  get(key: keyof typeof Env): any {
    return Env[key];
  }

  getString(key: keyof typeof Env): string | undefined {
    const value = this.get(key);
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new Error(`Configuration key ${String(key)} is not a string`);
    }
    return value;
  }

  getNumber(key: keyof typeof Env): number | undefined {
    const value = this.get(key);
    if (value === undefined) return undefined;
    if (typeof value !== "number") {
      throw new Error(`Configuration key ${String(key)} is not a number`);
    }
    return value;
  }

  getBoolean(key: keyof typeof Env): boolean | undefined {
    const value = this.get(key);
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") {
      throw new Error(`Configuration key ${String(key)} is not a boolean`);
    }
    return value;
  }

  // Helper methods for common configuration patterns
  getSupabaseConfig(): {
    url: string | undefined;
    anonKey: string | undefined;
    serviceRoleKey: string | undefined;
    jwtSecret: string | undefined;
  } {
    return {
      url: this.getString("SUPABASE_URL"),
      anonKey: this.getString("SUPABASE_ANON_KEY"),
      serviceRoleKey: this.getString("SUPABASE_SERVICE_ROLE_KEY"),
      jwtSecret: this.getString("SUPABASE_JWT_SECRET")
    };
  }

  get supabase() {
    return this.getSupabaseConfig();
  }

  getFileProcessingBucketName(): string | undefined {
    return this.getString("AWS_FILE_PROCESSING_BUCKET");
  }

  getContextBucketName(): string | undefined {
    return this.getString("AWS_CONTEXT_BUCKET");
  }

  getAssetsBucketName(): string | undefined {
    return this.getString("AWS_ASSETS_BUCKET");
  }

  getOpenAI(): { api_key: string | undefined } {
    return { api_key: this.getString("OPENAI_API_KEY") };
  }

  getAnthropicAPIKey(): { api_key: string | undefined } {
    return { api_key: this.getString("ANTHROPIC_API_KEY") };
  }

  getGeminiAISecret(): { api_key: string | undefined } {
    return { api_key: this.getString("GEMINI_API_KEY") };
  }

  getOrganizationAssetsBucketName(): string | undefined {
    return this.getString("AWS_ORGANIZATION_ASSETS_BUCKET");
  }

  getAWSConfig(): {
    region: string | undefined;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
  } {
    return {
      region: this.getString("AWS_REGION"),
      accessKeyId: this.getString("AWS_ACCESS_KEY_ID_S3"),
      secretAccessKey: this.getString("AWS_SECRET_ACCESS_KEY_S3")
    };
  }
}
