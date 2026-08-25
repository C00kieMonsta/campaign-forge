import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query. Initialised synchronously (no SSR here) so a panel
 * decided by it renders in the right place on the first paint instead of
 * flashing from mobile to desktop.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
