import { Injectable } from "@nestjs/common";
import type { LexLanguage, LexUserSettings } from "@packages/types";
import { PgService } from "../../shared/pg.service";
import { DEFAULT_LANGUAGE } from "./language-instruction";

interface SettingsRow {
  email: string;
  language: LexLanguage;
}

/**
 * Per-user settings. The row is created on first read (the admin allowlist is the source of
 * truth for who may sign in, so a settings row is derived, never a gate).
 *
 * `languageOf` is on the hot path of every model call, so it must never throw: an unknown user
 * or an unreachable row falls back to the default language rather than failing the turn.
 */
@Injectable()
export class SettingsService {
  constructor(private pg: PgService) {}

  async get(email: string): Promise<LexUserSettings> {
    const res = await this.pg.query<SettingsRow>(
      `INSERT INTO lex_users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = lex_users.email
       RETURNING email, language`,
      [email]
    );
    return { email: res.rows[0].email, language: res.rows[0].language };
  }

  async update(email: string, language: LexLanguage): Promise<LexUserSettings> {
    const res = await this.pg.query<SettingsRow>(
      `INSERT INTO lex_users (email, language) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET language = EXCLUDED.language
       RETURNING email, language`,
      [email, language]
    );
    return { email: res.rows[0].email, language: res.rows[0].language };
  }

  /** The pinned language, resolved defensively — never blocks a model call. */
  async languageOf(email: string): Promise<LexLanguage> {
    try {
      const res = await this.pg.query<{ language: LexLanguage }>(
        `SELECT language FROM lex_users WHERE email = $1`,
        [email]
      );
      return res.rows[0]?.language ?? DEFAULT_LANGUAGE;
    } catch {
      return DEFAULT_LANGUAGE;
    }
  }
}
