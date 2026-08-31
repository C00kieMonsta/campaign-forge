import { useCallback } from "react";
import { useLocalStorage } from "./use-local-storage";

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(n)));

/**
 * A resizable panel's width in px, persisted.
 *
 * px rather than a percentage because the thing being sized is a filename: the width that makes a
 * 60-character name readable is the same on a 1280px laptop and on a 2560px monitor.
 *
 * The stored value is clamped on READ but never written back on read. A width chosen on a wide
 * monitor has to survive an afternoon on a laptop, so a narrow window renders it capped and leaves
 * the preference alone.
 */
export function usePanelWidth(
  key: string,
  defaultWidth: number,
  min: number,
  max: number
) {
  const [stored, setStored] = useLocalStorage(key, defaultWidth);
  // Validated, not trusted. useLocalStorage does a bare JSON.parse of a user-writable key, and a
  // non-numeric value would make clamp return NaN — which reaches pdf.js as
  // page.getViewport({ scale: NaN / base.width }).
  const width = Number.isFinite(stored)
    ? clamp(stored, min, max)
    : defaultWidth;

  // The only writer, called on pointer RELEASE and on each keyboard nudge. localStorage.setItem is
  // synchronous, so writing per pointermove would be a disk write per frame of a drag.
  const commit = useCallback(
    (next: number) => setStored(clamp(next, min, max)),
    [setStored, min, max]
  );
  const reset = useCallback(
    () => setStored(defaultWidth),
    [setStored, defaultWidth]
  );

  return { width, commit, reset };
}
