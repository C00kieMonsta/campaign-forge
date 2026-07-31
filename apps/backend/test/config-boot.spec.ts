import { ConfigService } from "../src/config/config.service";

/**
 * Coexistence safety net: the backend is a SHARED process hosting both the live Campaigns
 * app and the new Lex app. Adding Lex config must never be able to fail startup. These
 * tests lock that guarantee in place so a future change (e.g. making a Lex key required,
 * or an empty `.env` line) is caught in CI instead of taking Campaigns down in prod.
 */
const LEGACY_ENV: Record<string, string> = {
  PORT: "3001",
  AWS_REGION: "eu-north-1",
  CONTACTS_TABLE: "cf-contacts",
  CAMPAIGNS_TABLE: "cf-campaigns",
  GROUPS_TABLE: "cf-groups",
  SES_FROM_EMAIL: "noreply@example.com",
  S3_BUCKET: "cf-attachments",
  UNSUBSCRIBE_SECRET: "x".repeat(32),
  PUBLIC_BASE_URL: "https://api.example.com/api",
  ADMIN_CREDENTIALS: JSON.stringify([
    { email: "admin@example.com", hash: "$2a$12$abcdefghijklmnopqrstuv" }
  ]),
  JWT_SECRET: "y".repeat(32)
};

describe("ConfigService — coexistence safety", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...LEGACY_ENV };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("boots with ONLY the legacy Campaigns env vars set (no Lex keys)", () => {
    expect(() => new ConfigService()).not.toThrow();
  });

  it("leaves optional Lex keys undefined when unset", () => {
    const config = new ConfigService();
    expect(config.get("DATABASE_URL")).toBeUndefined();
    expect(config.get("OPENAI_API_KEY")).toBeUndefined();
    expect(config.get("OPENAI_API_KEY_SECRET_ARN")).toBeUndefined();
    expect(config.get("LEX_DOCUMENTS_BUCKET")).toBeUndefined();
  });

  it("applies sensible defaults for Lex model config", () => {
    const config = new ConfigService();
    expect(config.get("OPENAI_EMBEDDING_MODEL")).toBe("text-embedding-3-large");
    expect(config.get("OPENAI_EMBEDDING_DIMENSIONS")).toBe(3072);
  });

  it("treats an empty-string Lex var the same as unset (the .env trap)", () => {
    // A deploy writing `DATABASE_URL=` (empty) must NOT fail `.url()` validation.
    process.env.DATABASE_URL = "";
    process.env.LEX_DOCUMENTS_BUCKET = "";
    process.env.OPENAI_API_KEY = "";

    let config!: ConfigService;
    expect(() => {
      config = new ConfigService();
    }).not.toThrow();
    expect(config.get("DATABASE_URL")).toBeUndefined();
    expect(config.get("LEX_DOCUMENTS_BUCKET")).toBeUndefined();
    expect(config.get("OPENAI_API_KEY")).toBeUndefined();
  });

  it("still fails fast if a REQUIRED Campaigns var is missing", () => {
    delete process.env.JWT_SECRET;
    expect(() => new ConfigService()).toThrow();
  });
});
