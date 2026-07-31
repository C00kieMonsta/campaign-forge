import {
  GetSecretValueCommand,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "../config/config.service";

/**
 * Lazy AWS Secrets Manager reader with an in-memory cache. Used to keep long-lived
 * credentials (e.g. the OpenAI API key) out of the plaintext EC2 `.env`. The client is
 * created on first use, not at boot.
 */
@Injectable()
export class SecretsService {
  private client?: SecretsManagerClient;
  private readonly cache = new Map<string, string>();

  constructor(private config: ConfigService) {}

  private getClient(): SecretsManagerClient {
    if (!this.client) {
      this.client = new SecretsManagerClient({
        region: this.config.get("AWS_REGION")
      });
    }
    return this.client;
  }

  async getSecretString(
    secretId: string,
    opts: { forceRefresh?: boolean } = {}
  ): Promise<string> {
    if (!opts.forceRefresh) {
      const cached = this.cache.get(secretId);
      if (cached !== undefined) return cached;
    }

    const res = await this.getClient().send(
      new GetSecretValueCommand({ SecretId: secretId })
    );
    if (!res.SecretString)
      throw new Error(`Secret ${secretId} has no string value`);

    this.cache.set(secretId, res.SecretString);
    return res.SecretString;
  }
}
