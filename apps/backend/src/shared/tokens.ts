/**
 * The one token estimate in this codebase.
 *
 * It replaces five separate implementations that had drifted into two different answers for the
 * same question — 3.4 chars per token in the context assembler and the authority digest cap, 4 in
 * the document chunker, the pager and the authority chunker, plus three inline `length / 4`
 * expressions that no name-based search would ever have found. Two numbers for one quantity is how
 * a budget computed in one module stops meaning what a budget computed in another module means.
 *
 * WHY AN ESTIMATE AND NOT A TOKENISER. A real BPE tokeniser was considered and rejected twice
 * before (see the note this constant replaces in context-assembler.service.ts), and the reasons
 * still hold, plus one more that is now decisive:
 *
 *   - The model registry names no encoding. Picking `o200k_base` for the gpt-5.6 family would be a
 *     guess, and a tokeniser applied with the wrong encoding is not more accurate than a ratio, it
 *     is confidently wrong.
 *   - It is per-turn CPU on a box shared with the Campaigns API, and the two hot callers are the
 *     worst shape for it: the eviction loop tokenises up to 24 message bodies on every chat turn,
 *     and capDigest re-tokenises a growing string once per line.
 *   - Almost nothing needs the accuracy. Of the eight call sites, six only write a `token_count`
 *     column that has no reader anywhere in the backend, the frontend, or the migrations.
 *
 * So the estimate stays, and the accuracy problem is addressed where it is free instead: the API
 * reports `usage.prompt_tokens` on every call, and OpenAiService logs it next to the estimate that
 * produced the request (`action: "lexModelUsage"`, field `estimateRatio`). That gives a measured
 * chars-per-token for this app's own FR/NL legal prose, on the model actually in use, at no CPU
 * cost. Calibrate this constant from that log rather than from a library's idea of English.
 *
 * 3.4 rather than 4 because it is the conservative direction: a lower divisor estimates MORE
 * tokens, so a budget built on it under-fills rather than overflows. FR and NL legal prose
 * tokenises worse than English, and an overflowing prompt fails a turn while an under-filled one
 * only carries less history.
 */
export const CHARS_PER_TOKEN = 3.4;

/** Estimated tokens in `text`. See CHARS_PER_TOKEN for why this is an estimate. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
