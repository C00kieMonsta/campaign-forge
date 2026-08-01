import { Injectable } from "@nestjs/common";
import { z } from "zod";

// Treats an empty string ("") the same as "unset". A deploy that writes an empty
// `.env` line for an optional key (e.g. `DATABASE_URL=`) would otherwise make the value
// a defined-but-empty string that FAILS `.url()`/validation and crashes the shared
// process. This keeps optional Lex keys from ever taking the Campaigns app down.
function emptyAsUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema);
}

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  // NOTE: prod runs in eu-north-1 (see cd-deploy.yml); the default now matches reality.
  AWS_REGION: z.string().default("eu-north-1"),
  CONTACTS_TABLE: z.string().min(1),
  CAMPAIGNS_TABLE: z.string().min(1),
  GROUPS_TABLE: z.string().min(1),
  DDB_ENDPOINT: z.string().url().optional(),
  SES_FROM_EMAIL: z.string().email(),
  SES_REGION: z.string().default("eu-north-1"),
  S3_BUCKET: z.string().min(1),
  UNSUBSCRIBE_SECRET: z.string().min(32),
  PUBLIC_BASE_URL: z.string().url(),
  ADMIN_CREDENTIALS: z.string().min(1),
  JWT_SECRET: z.string().min(32),

  // ── Lex (legal-RAG app) ─────────────────────────────────────────────────────────────
  // ALL Lex keys are optional/defaulted on purpose: their absence (or an empty value) must
  // NEVER fail startup, so that adding Lex to the shared backend process cannot bring the
  // live Campaigns app down. The Lex services validate their own required config lazily,
  // on first use, and simply return an error to Lex callers if unconfigured.
  DATABASE_URL: emptyAsUndefined(z.string().url().optional()),
  DATABASE_SSL: emptyAsUndefined(z.string().default("true")),
  OPENAI_API_KEY: emptyAsUndefined(z.string().optional()),
  OPENAI_API_KEY_SECRET_ARN: emptyAsUndefined(z.string().optional()),
  // No chat-model keys here on purpose: the roster lives in @packages/types/models, where the
  // choice is reviewable in a diff and cannot drift between environments. The embedding model DOES
  // stay configurable — changing it invalidates every stored vector, so it is a deploy-time
  // decision tied to the data, not a code preference.
  OPENAI_EMBEDDING_MODEL: emptyAsUndefined(
    z.string().default("text-embedding-3-large")
  ),
  OPENAI_EMBEDDING_DIMENSIONS: emptyAsUndefined(
    z.coerce.number().default(3072)
  ),
  OPENAI_TRANSCRIBE_MODEL: emptyAsUndefined(z.string().default("whisper-1")),
  LEX_DOCUMENTS_BUCKET: emptyAsUndefined(z.string().optional()),
  // Mistral OCR — used only for scanned/no-text-layer documents + images.
  MISTRAL_API_KEY: emptyAsUndefined(z.string().optional()),
  MISTRAL_OCR_MODEL: emptyAsUndefined(z.string().default("mistral-ocr-latest"))
});

export type Env = z.infer<typeof schema>;

@Injectable()
export class ConfigService {
  private readonly env: Env;

  constructor() {
    this.env = schema.parse(process.env);
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  get tables() {
    return {
      contacts: this.env.CONTACTS_TABLE,
      campaigns: this.env.CAMPAIGNS_TABLE,
      groups: this.env.GROUPS_TABLE
    };
  }
}
