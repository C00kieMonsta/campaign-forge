import type { LexLanguage } from "@packages/types";

const LANGUAGE_NAMES: Record<LexLanguage, string> = {
  fr: "French",
  nl: "Dutch"
};

/** The language every model call writes in when nothing has been pinned yet. */
export const DEFAULT_LANGUAGE: LexLanguage = "fr";

export function languageName(language: LexLanguage): string {
  return LANGUAGE_NAMES[language] ?? LANGUAGE_NAMES[DEFAULT_LANGUAGE];
}

/**
 * The pinned-output-language directive, shared by every prompt that produces user-facing text
 * (chat replies, conversation summaries, generated drafts, document summaries).
 *
 * The carve-out is not optional: verbatim quotes MUST stay in their source language. Generated
 * drafts are verified by matching each claim's `quote` against the source chunk
 * (VerificationService.quoteMatchesChunk), so a translated quote silently fails verification and
 * the whole document comes back unverified.
 */
export function outputLanguageInstruction(language: LexLanguage): string {
  const name = languageName(language);
  return (
    `OUTPUT LANGUAGE: write every word of your response in ${name}. ` +
    `This is absolute — it does not matter what language the sources, the documents or the ` +
    `earlier conversation are in. The ONLY exception: text you quote verbatim from a source ` +
    `stays in its original language, unchanged (you may add a short ${name} gloss after it).`
  );
}
