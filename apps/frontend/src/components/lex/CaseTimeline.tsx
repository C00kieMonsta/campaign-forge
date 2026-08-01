import { useMemo, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { YearBands } from "@/lib/caseStory";
import { cn } from "@/lib/utils";

/**
 * The chronology as YEAR BANDS: one column per year that carries something, each item a block in a
 * stack, with runs of empty years collapsed into a marker that states how long they are.
 *
 * WHY NOT A CONTINUOUS AXIS, which is what this replaced. Measured on a real file the facts fall into
 * 23 years across seven decades — one in 1928, then a 26-year silence, then a dozen in 1998. Placed
 * proportionally, the oldest act sits alone at the far left and the litigation crushes into the right
 * tenth: overlapping marks, no readable sequence, no sense of density. Banding gives each populated
 * year equal width and STACKS its items, so nothing can overlap however many there are, and the
 * elapsed time moves into the gap markers where it can be read as a number.
 *
 * The trade is explicit: the axis is no longer linear in time. That is only acceptable because every
 * silence is labelled — "26 ans" — so the chronology cannot be misread as evenly paced. Spacing that
 * misleads quietly would be worse than spacing that hands over the figure.
 *
 * WHAT THE FILL MEANS, and why one channel rather than a second row. This replaced a money bar drawn
 * under the axis, which summed amounts by the FILING year of the piece and therefore attributed a 1992
 * donation to the 2023 conclusions that argued it — the right question against the wrong denominator.
 * A block is FILLED when the row it stands for carries a figure and OUTLINED when it does not, so
 * "where is the money in time" is answered against the act date. Both keys are always in the legend,
 * so a file with no amounts reads as "all outlined" rather than as a missing feature.
 */

/** Geometry. Sized so 23 bands and 9 gaps — the real file at its default cut — fit 1152px unscrolled. */
const BAND_WIDTH = 34;
const GAP_WIDTH = 24;
const BLOCK_HEIGHT = 13;
const BLOCK_GAP = 2;
const AXIS_LABEL_HEIGHT = 18;
const TOP_PADDING = 8;
/** Room above the tallest stack for the "+n" numeral, and for the death rule's label. */
const OVERFLOW_LABEL_HEIGHT = 11;
const MARKER_LABEL_HEIGHT = 12;

/**
 * Blocks drawn in one band before the rest become a numeral.
 *
 * 12 is measured, not chosen: 1998 carries twelve facts on the real file at the default cut, so the
 * cap is set exactly where the tallest real stack sits. Beyond it the band would grow taller than the
 * chart and push the axis off screen — and a stack of forty identical rectangles stops being countable
 * anyway. What is hidden is stated in the band, per C8.
 */
const MAX_BLOCKS_PER_BAND = 12;

export interface TimelineBlockItem {
  id: string;
  date: string;
}

export default function CaseTimeline<T extends TimelineBlockItem>({
  bands,
  filledIds,
  activeId,
  selectedYear,
  marker,
  labelOf,
  yearLabelOf,
  onSelectItem,
  onSelectYear
}: {
  bands: YearBands<T>;
  /** Items drawn filled — on this page, the facts that carry an amount. */
  filledIds?: ReadonlySet<string>;
  /** The row the reader last jumped to, outlined so the chart and the table agree. */
  activeId?: string | null;
  selectedYear: string | null;
  /** One labelled vertical rule. On this page it is the date a document writes "décédé le" in front of. */
  marker?: { year: string; label: string } | null;
  /** Accessible name of a block. The caller knows whether it is a fact or a filing. */
  labelOf: (item: T) => string;
  /** Accessible name of a year control, count included. */
  yearLabelOf: (year: string, count: number) => string;
  onSelectItem: (item: T) => void;
  onSelectYear: (year: string | null) => void;
}) {
  const { t } = useLanguage();
  const s = t.lex.story;

  /**
   * Which element has keyboard focus, so an explicit ring can be drawn.
   *
   * SVG shapes take no default focus indicator in several browsers, and a control a keyboard user
   * cannot see is a control they cannot use. Tracked in state rather than left to :focus-visible
   * because the ring is a sibling <rect> inside the group, not a CSS outline on it.
   */
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

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
  const overflows = bands.maxCount > MAX_BLOCKS_PER_BAND;
  const stackHeight =
    Math.max(1, Math.min(bands.maxCount, MAX_BLOCKS_PER_BAND)) *
    (BLOCK_HEIGHT + BLOCK_GAP);
  const topPadding =
    TOP_PADDING +
    (overflows ? OVERFLOW_LABEL_HEIGHT : 0) +
    (marker ? MARKER_LABEL_HEIGHT : 0);
  const baseline = topPadding + stackHeight;
  const height = baseline + AXIS_LABEL_HEIGHT;

  /** Where the marker's rule falls, or null when its year has no band at the current cut. */
  const markerX = useMemo(() => {
    if (!marker) return null;
    let cursor = 0;
    for (const column of columns) {
      if (column.kind === "gap") {
        cursor += GAP_WIDTH;
        continue;
      }
      if (bands.bands[column.index].year === marker.year)
        return cursor + BAND_WIDTH / 2;
      cursor += BAND_WIDTH;
    }
    return null;
  }, [marker, columns, bands]);

  if (bands.bands.length === 0)
    return <p className="text-sm text-muted-foreground">{s.frise.empty}</p>;

  let cursor = 0;
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${Math.max(width, 320)} ${height}`}
        width={Math.max(width, 320)}
        height={height}
        className="max-w-full h-auto"
        role="group"
        aria-label={s.frise.title}
      >
        <line
          x1={0}
          y1={baseline}
          x2={width}
          y2={baseline}
          stroke="currentColor"
          strokeOpacity={0.15}
        />

        {/* The one annotation the chart carries: a date a document writes a death trigger in front
            of. Drawn under the blocks so it never hides one. */}
        {marker && markerX !== null ? (
          <g pointerEvents="none">
            <title>{s.frise.deathRule.replace("{date}", marker.label)}</title>
            <line
              x1={markerX}
              y1={topPadding - MARKER_LABEL_HEIGHT}
              x2={markerX}
              y2={baseline}
              stroke="currentColor"
              strokeOpacity={0.45}
              strokeDasharray="3 2"
            />
            <text
              x={markerX}
              y={topPadding - MARKER_LABEL_HEIGHT + 8}
              textAnchor="middle"
              className="text-[9px] tabular-nums fill-muted-foreground"
            >
              {marker.label}
            </text>
          </g>
        ) : null}

        {columns.map((column) => {
          const x = cursor;
          cursor += column.kind === "band" ? BAND_WIDTH : GAP_WIDTH;

          if (column.kind === "gap") {
            // A silence, stated. This is what buys the right to give every year equal width.
            return (
              <g key={`gap-${column.gap.fromYear}`} pointerEvents="none">
                <line
                  x1={x + GAP_WIDTH / 2}
                  y1={topPadding}
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
          const shown = band.items.slice(0, MAX_BLOCKS_PER_BAND);
          const hidden = band.items.length - shown.length;
          const yearKey = `year:${band.year}`;

          return (
            <g key={band.year} opacity={dimmed ? 0.35 : 1}>
              {/* The stack. One block per item — never overlapping, whatever the count. */}
              {shown.map((item, i) => {
                const y = baseline - (i + 1) * (BLOCK_HEIGHT + BLOCK_GAP);
                const label = labelOf(item);
                const key = `item:${item.id}`;
                const filled = filledIds?.has(item.id) ?? false;
                return (
                  <g
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    className="cursor-pointer"
                    onClick={() => onSelectItem(item)}
                    onFocus={() => setFocusedKey(key)}
                    onBlur={() => setFocusedKey(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectItem(item);
                      }
                    }}
                  >
                    <title>{label}</title>
                    {focusedKey === key ? (
                      <rect
                        x={x + 2}
                        y={y - 2}
                        width={BAND_WIDTH - 4}
                        height={BLOCK_HEIGHT + 4}
                        rx={3}
                        className="fill-none stroke-foreground"
                        strokeWidth={1.5}
                      />
                    ) : null}
                    <rect
                      x={x + 5}
                      y={y}
                      width={BAND_WIDTH - 10}
                      height={BLOCK_HEIGHT}
                      rx={2}
                      strokeWidth={1}
                      className={cn(
                        filled
                          ? "fill-primary/70 stroke-primary hover:fill-primary"
                          : "fill-background stroke-primary/60 hover:fill-primary/20",
                        activeId === item.id && "stroke-foreground"
                      )}
                    />
                  </g>
                );
              })}

              {/* What the cap hid, in the band itself rather than only in a caption. */}
              {hidden > 0 ? (
                <g pointerEvents="none">
                  <title>
                    {s.frise.bandMore.replace("{count}", String(hidden))}
                  </title>
                  <text
                    x={x + BAND_WIDTH / 2}
                    y={baseline - shown.length * (BLOCK_HEIGHT + BLOCK_GAP) - 3}
                    textAnchor="middle"
                    className="text-[8px] tabular-nums fill-muted-foreground"
                  >
                    {`+${hidden}`}
                  </text>
                </g>
              ) : null}

              {/* The year label doubles as the band's filter control. */}
              <g
                role="button"
                tabIndex={0}
                aria-label={yearLabelOf(band.year, band.items.length)}
                aria-pressed={active}
                className="cursor-pointer"
                onClick={() => onSelectYear(active ? null : band.year)}
                onFocus={() => setFocusedKey(yearKey)}
                onBlur={() => setFocusedKey(null)}
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
                  className={cn(
                    active ? "fill-primary/10" : "fill-transparent",
                    focusedKey === yearKey && "stroke-foreground"
                  )}
                  strokeWidth={focusedKey === yearKey ? 1.5 : 0}
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
            </g>
          );
        })}
      </svg>
    </div>
  );
}
