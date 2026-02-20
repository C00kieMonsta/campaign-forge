import { Injectable } from "@nestjs/common";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  AWS_REGION: z.string().default("eu-west-1"),
  CONTACTS_TABLE: z.string().min(1),
  CAMPAIGNS_TABLE: z.string().min(1),
  DDB_ENDPOINT: z.string().url().optional(),
  SES_FROM_EMAIL: z.string().email(),
  SES_REGION: z.string().default("eu-west-1"),
  UNSUBSCRIBE_SECRET: z.string().min(32),
  PUBLIC_BASE_URL: z.string().url(),
  ADMIN_CREDENTIALS: z.string().min(1),
  JWT_SECRET: z.string().min(32),
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
    return { contacts: this.env.CONTACTS_TABLE, campaigns: this.env.CAMPAIGNS_TABLE };
  }
}
