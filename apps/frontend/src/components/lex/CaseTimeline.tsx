import { useMemo } from "react";
import type { LexDocument } from "@packages/types";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatAmount, type YearBands, type YearMoney } from "@/lib/caseStory";
import { cn } from "@/lib/utils";

/**
 * The chronology as YEAR BANDS: one column per year that has documents, each document a block in a
 * stack, with runs of empty years collapsed into a marker that states how long they are.
 *
 * WHY NOT A CONTINUOUS AXIS, which is what this replaced. Measured on a real file the documents fall
 * into 16 years across seven decades — one in 1958, then nothing until 1989, then clusters of 7, 8 and
 * 8. Placed proportionally, the 1958 contract sits alone at the far left and forty documents crush
 * into the right tenth: overlapping dots, no readable sequence, no sense of density. Banding gives
 * each populated year equal width and STACKS its documents, so nothing can overlap however many there
 * are, and the elapsed time moves into the gap markers where it can be read as a number.
 *
 * The trade is explicit: the axis is no longer linear in time. That is only acceptable because every
 * silence is labelled — "1959-1988 · 30 ans" — so the chronology cannot be misread as evenly paced.
 * Spacing that misleads quietly would be worse than spacing that hands over the figure.
 */

/** Geometry. A block is sized so the tallest real stack (8 documents) fits without scrolling. */
const BAND_WIDTH = 46;
const GAP_WIDTH = 34;
const BLOCK_HEIGHT = 13;
const BLOCK_GAP = 2;
const MONEY_HEIGHT = 26;
const AXIS_LABEL_HEIGHT = 18;
const TOP_PADDING = 8;

export default function CaseTimeline({
  bands,
  money,
  documentsById,
  selectedYear,
  onSelectYear,
  onOpenDocument
}: {
  bands: YearBands<{ id: string; date: string }>;
  /** Indicative euro per year, plus the counts that stop a bar of zero from lying. */
  money: ReadonlyMap<string, YearMoney>;
  documentsById: ReadonlyMap<string, LexDocument>;
  selectedYear: string | null;
  onSelectYear: (year: string | null) => void;
  onOpenDocument: (doc: LexDocument) => void;
}) {
  const { t } = useLanguage();
  const s = t.lex.story;

  /** Columns in render order: a band, or a gap marker standing between two bands. */
  const columns = useMemo(() => {
    const gapBefore = new Map(bands.gaps.map((g) => [g.beforeIndex, g]));
    const out: (
      | { kind: "band"; index: number }
      | { kind: "gap"; gap: (typeof bands.gaps)[number] }
    )[] = [];
    bands.bands.forEach((_, index) => {
      const gap = gapBefore.get(index);
      if (gap) out.push({ kind: "gap", gap });
      out.push({ kind: "band", index });
    });
    return out;
  }, [bands]);

  const width = columns.reduce(
    (sum, column) => sum + (column.kind === "band" ? BAND_WIDTH : GAP_WIDTH),
    0
  );
  const stackHeight = Math.max(1, bands.maxCount) * (BLOCK_HEIGHT + BLOCK_GAP);
  const baseline = TOP_PADDING + stackHeight;
  const height = baseline + AXIS_LABEL_HEIGHT + MONEY_HEIGHT;

  /** Largest euro figure in any year, for scaling the money strip. */
  const peakEur = useMemo(() => {
    let peak = 0;
    for (const entry of money.values())
      if (entry.eur !== null) peak = Math.max(peak, Math.abs(entry.eur));
    return peak;
  }, [money]);

  if (bands.bands.length === 0) return null;

  let cursor = 0;
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${Math.max(width, 320)} ${height}`}
        width={Math.max(width, 320)}
        height={height}
        className="max-w-full h-auto"
        role="group"
        aria-label={s.timelineTitle}
      >
        <line
          x1={0}
          y1={baseline}
          x2={width}
          y2={baseline}
          stroke="currentColor"
          strokeOpacity={0.15}
        />

        {columns.map((column) => {
          const x = cursor;
          cursor += column.kind === "band" ? BAND_WIDTH : GAP_WIDTH;

          if (column.kind === "gap") {
            // A silence, stated. This is what buys the right to give every year equal width.
            return (
              <g key={`gap-${column.gap.fromYear}`} pointerEvents="none">
                <line
                  x1={x + GAP_WIDTH / 2}
                  y1={TOP_PADDING}
                  x2={x + GAP_WIDTH / 2}
                  y2={baseline}
                  stroke="currentColor"
                  strokeOpacity={0.2}
                  strokeDasharray="2 3"
                />
                <text
                  x={x + GAP_WIDTH / 2}
                  y={baseline + 12}
                  textAnchor="middle"
                  className="text-[8px] fill-muted-foreground"
                >
                  {`${column.gap.years} ${s.yearsShort}`}
                </text>
              </g>
            );
          }

          const band = bands.bands[column.index];
          const active = selectedYear === band.year;
          const dimmed = selectedYear !== null && !active;
          const yearMoney = money.get(band.year);
          const barHeight =
            yearMoney?.eur && peakEur > 0
              ? Math.max(
                  2,
                  (Math.abs(yearMoney.eur) / peakEur) * (MONEY_HEIGHT - 8)
                )
              : 0;

          return (
            <g key={band.year} opacity={dimmed ? 0.35 : 1}>
              {/* The stack. One block per document — never overlapping, whatever the count. */}
              {band.items.map((item, i) => {
                const doc = documentsById.get(item.id);
                const y = baseline - (i + 1) * (BLOCK_HEIGHT + BLOCK_GAP);
                const label = `${item.date} — ${doc?.filename ?? item.id}`;
                return (
                  <g
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    className="cursor-pointer"
                    onClick={() => doc && onOpenDocument(doc)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && doc) onOpenDocument(doc);
                    }}
                  >
                    <title>{label}</title>
                    <rect
                      x={x + 5}
                      y={y}
                      width={BAND_WIDTH - 10}
                      height={BLOCK_HEIGHT}
                      rx={2}
                      className={cn(
                        active ? "fill-primary" : "fill-primary/45",
                        "hover:fill-primary"
                      )}
                    />
                  </g>
                );
              })}

              {/* The year label doubles as the band's select control. */}
              <g
                role="button"
                tabIndex={0}
                aria-label={s.yearDocuments
                  .replace("{year}", band.year)
                  .replace("{count}", String(band.items.length))}
                aria-pressed={active}
                className="cursor-pointer"
                onClick={() => onSelectYear(active ? null : band.year)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectYear(active ? null : band.year);
                  }
                }}
              >
                <rect
                  x={x}
                  y={baseline + 1}
                  width={BAND_WIDTH}
                  height={AXIS_LABEL_HEIGHT - 2}
                  className={active ? "fill-primary/10" : "fill-transparent"}
                />
                <text
                  x={x + BAND_WIDTH / 2}
                  y={baseline + 12}
                  textAnchor="middle"
                  className={cn(
                    "text-[9px] tabular-nums",
                    active
                      ? "fill-foreground font-medium"
                      : "fill-muted-foreground"
                  )}
                >
                  {band.year}
                </text>
              </g>

              {/* Money in time. A year with only unconvertible amounts gets a HATCHED marker rather
                  than a bar of zero, which would read as "no money here". */}
              {yearMoney ? (
                <g pointerEvents="none">
                  <title>
                    {yearMoney.eur !== null
                      ? `${band.year} — ${formatAmount(yearMoney.eur, "EUR")} ${s.indicativeShort}`
                      : `${band.year} — ${s.notConvertible}`}
                  </title>
                  {barHeight > 0 ? (
                    <rect
                      x={x + 12}
                      y={height - 4 - barHeight}
                      width={BAND_WIDTH - 24}
                      height={barHeight}
                      className="fill-primary/70"
                    />
                  ) : (
                    <rect
                      x={x + 12}
                      y={height - 7}
                      width={BAND_WIDTH - 24}
                      height={3}
                      className="fill-muted-foreground/40"
                    />
                  )}
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
