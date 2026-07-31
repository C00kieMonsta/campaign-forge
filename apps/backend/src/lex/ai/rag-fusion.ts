// Pure Reciprocal Rank Fusion — extracted from RagService so it is unit-testable without
// loading pg/openai. Fuses N ranked lists by summing 1/(k + rank) per item id.

export const RRF_K = 60;

export function reciprocalRankFusion<T extends { id: string }>(
  lists: T[][],
  opts: { topK: number; k?: number }
): { item: T; score: number }[] {
  const k = opts.k ?? RRF_K;
  const scores = new Map<string, number>();
  const items = new Map<string, T>();

  for (const list of lists) {
    list.forEach((item, rank) => {
      items.set(item.id, item);
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank + 1));
    });
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.topK);

  const out: { item: T; score: number }[] = [];
  for (const [id, score] of ranked) {
    const item = items.get(id);
    if (item) out.push({ item, score }); // guard, not a non-null assertion
  }
  return out;
}
