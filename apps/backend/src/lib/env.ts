import { z } from "zod";

const schema = z.object({
  CONTACTS_TABLE: z.string().min(1),
  CAMPAIGNS_TABLE: z.string().min(1),
  SES_FROM_EMAIL: z.string().email(),
  SES_REGION: z.string().default("eu-west-1"),
  UNSUBSCRIBE_SECRET: z.string().min(32),
  PUBLIC_BASE_URL: z.string().url(),
  COGNITO_ISSUER: z.string().url(),
  COGNITO_CLIENT_ID: z.string().min(1),
  ADMIN_ALLOWLIST: z.string().optional(),
  AWS_REGION: z.string().default("eu-west-1"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  cached = schema.parse(process.env);
  return cached;
}

export function getAdminAllowlist(): string[] {
  const { ADMIN_ALLOWLIST } = getEnv();
  if (!ADMIN_ALLOWLIST) return [];
  return ADMIN_ALLOWLIST.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
}
