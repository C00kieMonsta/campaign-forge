import { envFromSchema } from "@packages/utils";
import { z } from "zod";

export const Env = envFromSchema({
  // Database Configuration (required for Prisma)
  DATABASE_URL: z.string().url().optional(),

  // AWS Configuration (optional for testing)
  AWS_ORGANIZATION_ASSETS_BUCKET: z.string().min(1).optional(),
  AWS_FILE_PROCESSING_BUCKET: z.string().min(1).optional(),
  AWS_CONTEXT_BUCKET: z.string().min(1).optional(),
  AWS_ASSETS_BUCKET: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID_S3: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY_S3: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),

  // AI Service API Keys (optional for testing)
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  MISTRAL_API_KEY: z.string().min(1).optional(),

  // Supabase Configuration (optional for testing, fallback for DATABASE_URL)
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),

  // Email Configuration
  AWS_SES_FROM_EMAIL: z.string().email().optional(),
  FRONTEND_URL: z.string().url().optional(),

  // Application Configuration (required)
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8001),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info")
});

export type Env = typeof Env;
