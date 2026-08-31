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

/**
 * Markers the answer wrote that point past the end of the SOURCES list.
 *
 * extractCitedIndexes drops these silently, which is right for the citation rows and hides a signal
 * worth having: a model with an inventory of the whole case file in front of it may try to cite a
 * document whose text was never in SOURCES. This number rising after the CASE FILE block shipped is
 * that failure, measured. Nothing acts on it yet.
 */
export function countOutOfRangeMarkers(
  text: string,
  sourceCount: number
): number {
  let n = 0;
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const i = Number(m[1]);
    if (i < 1 || i > sourceCount) n += 1;
  }
  return n;
}
