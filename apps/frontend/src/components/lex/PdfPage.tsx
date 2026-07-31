import { memo, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { PdfDocument } from "./pdf";

/**
 * One rendered PDF page, selectable.
 *
 * Rendering is lazy (IntersectionObserver): a 200-page filing would otherwise rasterise every
 * page on open and lock the tab. Each page renders once, when it first scrolls into view.
 */
export const PdfPage = memo(function PdfPage({
  doc,
  pageNumber,
  width,
  selected = false,
  onToggle,
  selectLabel
}: {
  doc: PdfDocument;
  pageNumber: number;
  width: number;
  selected?: boolean;
  /** Omit to render a read-only page: plain reading, no selection affordance. */
  onToggle?: (page: number) => void;
  selectLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const node = holderRef.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || rendered) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const render = page.render({ canvasContext: context, viewport, canvas });
      task = render;
      try {
        await render.promise;
        if (!cancelled) setRendered(true);
      } catch {
        /* cancelled render — nothing to do */
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, rendered, doc, pageNumber, width]);

  return (
    <div ref={holderRef} className="relative">
      {onToggle ? (
        <button
          onClick={() => onToggle(pageNumber)}
          aria-pressed={selected}
          title={`${selectLabel ?? ""} ${pageNumber}`.trim()}
          className={`block w-full rounded-lg border-2 overflow-hidden transition-colors ${
            selected
              ? "border-sidebar-primary"
              : "border-border hover:border-muted-foreground"
          }`}
        >
          <canvas ref={canvasRef} className="block w-full bg-white" />
          {!rendered ? (
            <span className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
          ) : null}
        </button>
      ) : (
        // Read-only: no button, no hover affordance — nothing here is clickable.
        <div className="block w-full rounded-lg border overflow-hidden">
          <canvas ref={canvasRef} className="block w-full bg-white" />
          {!rendered ? (
            <span className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
          ) : null}
        </div>
      )}
      <span
        className={`absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          selected
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "bg-background/90 text-muted-foreground"
        }`}
      >
        {selected ? <Check className="h-3 w-3" /> : null}
        {pageNumber}
      </span>
    </div>
  );
});
