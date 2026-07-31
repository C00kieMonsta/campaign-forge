import { useEffect, useRef, useState } from "react";

/**
 * Returns `value`, but updated at most once per `delayMs`, always with a trailing update so the
 * final value is never lost.
 *
 * Used for the streaming assistant reply: tokens arrive many times a second, and re-parsing the
 * whole Markdown document on each one is wasted work that shows up as jank on a long answer.
 */
export function useThrottled<T>(value: T, delayMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastRun = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const elapsed = performance.now() - lastRun.current;
    if (elapsed >= delayMs) {
      lastRun.current = performance.now();
      setThrottled(value);
      return;
    }
    // Too soon — schedule the trailing update instead of dropping this value.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lastRun.current = performance.now();
      setThrottled(value);
    }, delayMs - elapsed);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delayMs]);

  return throttled;
}
