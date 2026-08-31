import { useEffect } from "react";

/**
 * Publishes the visible viewport height as `--app-height`, and pins the shell into view.
 *
 * `dvh` does not shrink when the iOS keyboard opens: Safari treats the keyboard as an overlay, so a
 * `h-dvh` shell keeps its full height and the composer at its bottom ends up behind the keys. The
 * visual viewport does shrink, so the shell is sized from that instead.
 *
 * The height alone is not enough. iOS also PANS the visual viewport to bring a focused input into
 * view, which moves the document under the window: a shell sized to the visible area still has its
 * header scrolled off the top. `visualViewport.scroll` is the only event that reports that offset,
 * so it is listened to and the window is scrolled back to zero, which is what keeps the header put.
 *
 * When there is no visualViewport (older desktop browsers) the variable is deliberately NOT set, so
 * the `100dvh` CSS fallback stays live. Writing a one-off pixel height there would freeze the shell
 * at whatever the window was on mount, which is worse than today.
 */
export function useAppHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;
    const apply = () => {
      // Pinch-zoomed, vv.height is the zoomed slice rather than the screen. Sizing the shell to it
      // would collapse the layout while someone is reading a scan.
      if (vv.scale > 1.01) return;
      document.documentElement.style.setProperty(
        "--app-height",
        `${Math.round(vv.height)}px`
      );
      // The shell fills the visible area, so any document scroll is iOS having panned for the
      // keyboard. Undoing it is what stops the header sliding away.
      if (vv.offsetTop > 0 || window.scrollY > 0) window.scrollTo(0, 0);
    };

    // rAF-throttled: `scroll` fires continuously during a pinch-pan, and each call writes a custom
    // property that the whole shell is sized from.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
    };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("resize", schedule);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}
