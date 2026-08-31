import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";

/** Set on <html> while a drag is in flight; see the [data-lex-resizing] rule in index.css. */
const RESIZING_ATTR = "lexResizing";

/**
 * The draggable rule between an inline panel and the conversation.
 *
 * The width being dragged is a CSS variable on the row element, written here directly. Routing it
 * through the workspace's state instead would re-render the whole thread on every pointermove, and
 * a long conversation re-parses its markdown on each of those renders. Only the release commits,
 * which is the one render a drag costs.
 *
 * `side` says which way widening goes: the documents panel grows to the right of its rule, the
 * pinned panel to the left of its.
 */
export function PanelResizer({
  side,
  cssVar,
  target,
  value,
  min,
  max,
  step = 24,
  onCommit,
  onReset,
  label,
  title
}: {
  side: "right" | "left";
  /** The custom property the row carries, e.g. "--lex-docs-w". */
  cssVar: string;
  /** The row element that owns the variable. */
  target: RefObject<HTMLElement | null>;
  /** Committed width: the starting point of a drag, and the value after a release. */
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (width: number) => void;
  onReset: () => void;
  label: string;
  title?: string;
}) {
  const drag = useRef<{ x: number; from: number; latest: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const sign = side === "right" ? 1 : -1;
  const shown = live ?? value;

  /**
   * The flag has to come off even if this component goes away mid-drag.
   *
   * A breakpoint flip, or the last pinned tab closing while its rule is being dragged, unmounts the
   * node. Pointer capture is then released implicitly and no pointerup or pointercancel ever
   * arrives, so without this `cursor: col-resize !important; user-select: none !important` stayed on
   * the whole app until a reload.
   */
  useEffect(
    () => () => {
      delete document.documentElement.dataset[RESIZING_ATTR];
    },
    []
  );

  const apply = useCallback(
    (next: number) => {
      const clamped = Math.max(min, Math.min(max, Math.round(next)));
      target.current?.style.setProperty(cssVar, `${clamped}px`);
      setLive(clamped);
      return clamped;
    },
    [cssVar, target, min, max]
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // primary button only; a right-click is a context menu
    drag.current = { x: e.clientX, from: value, latest: value };
    e.currentTarget.setPointerCapture(e.pointerId);
    // Focused explicitly rather than preventing the default. preventDefault on pointerdown also
    // cancels the focus, which left the keyboard controls reachable only by tabbing to a 1px
    // element, and suppressed the compatibility mouse events that dblclick-to-reset rides on.
    // Text selection during the drag is handled by the user-select rule the attribute below turns
    // on, not by cancelling this event.
    e.currentTarget.focus();
    document.documentElement.dataset[RESIZING_ATTR] = "true";
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.latest = apply(d.from + sign * (e.clientX - d.x));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    delete document.documentElement.dataset[RESIZING_ATTR];
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!d) return;
    setLive(null); // the committed value takes over on the next render
    onCommit(d.latest);
  };

  /**
   * Arrows, Home and End all move the RULE in the named direction, whichever panel it sizes. For a
   * left-side rule that means Home is the panel's MAXIMUM: moving the rule as far left as it goes
   * makes the panel to its right as wide as it goes.
   *
   * Clamped against `max` here as well as in commit, because `max` is the DYNAMIC cap (what the
   * conversation's floor leaves) while commit clamps to the panel's static ceiling. Without this,
   * once the stored width passed the dynamic cap, further presses moved nothing on screen and
   * nothing in aria-valuenow while the stored number kept growing.
   */
  const clampToBounds = (n: number) => Math.max(min, Math.min(max, n));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") onCommit(clampToBounds(value - sign * step));
    else if (e.key === "ArrowRight")
      onCommit(clampToBounds(value + sign * step));
    else if (e.key === "Home") onCommit(side === "right" ? min : max);
    else if (e.key === "End") onCommit(side === "right" ? max : min);
    else if (e.key === "Enter" || e.key === " ") onReset();
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={shown}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // Capture can be lost without a pointerup (another element grabbing it, a browser gesture),
      // and the attribute has to come off on that path too.
      onLostPointerCapture={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      // Transparent at rest: the panels keep their own borders, so this is an affordance inside the
      // existing gutter rather than a second visible line beside a border.
      // touch-none: on a touch laptop a horizontal drag here is a resize, not a page scroll.
      // The after: box is the part a pointer can actually hit — the rule itself is 1px.
      className="relative w-px shrink-0 cursor-col-resize touch-none rounded-full bg-transparent transition-colors hover:bg-primary/60 active:bg-primary/60 focus-visible:bg-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-y-0 after:-left-2 after:-right-2 after:content-['']"
    />
  );
}
