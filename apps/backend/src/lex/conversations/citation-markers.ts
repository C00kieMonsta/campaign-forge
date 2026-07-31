// Pure helper: which sources did the assistant actually cite via inline [n] markers?
// Extracted from ConversationsService so it is unit-testable in isolation. Returns the
// distinct, in-bounds, ascending 1-based indexes referenced in the text.

export function extractCitedIndexes(
  text: string,
  sourceCount: number
): number[] {
  const cited = new Set<number>();
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= sourceCount) cited.add(n);
  }
  return [...cited].sort((a, b) => a - b);
}
