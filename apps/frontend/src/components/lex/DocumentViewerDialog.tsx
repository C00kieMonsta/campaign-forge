import { useCallback, useEffect, useRef, useState } from "react";
import type { LexDocument } from "@packages/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@packages/ui";
import { Download, Loader2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errorMessage";
import { loadPdf, type LoadedPdf, type PdfDocument } from "./pdf";
import { PdfPage } from "./PdfPage";

// Wide enough to actually read a scanned filing. The dialog is max-w-5xl, so this fits with room
// for padding — this view is for reading, unlike the narrow pinned panel.
const PAGE_WIDTH = 720;

/**
 * Reads a document, full size, in a dialog. Nothing else.
 *
 * Deliberately NOT a page picker: choosing pages to put in front of the assistant belongs to the
 * pinned panel, where the document stays open beside the conversation while you work. Making this
 * modal do both meant a quick look also demanded a decision about references.
 */
export default function DocumentViewerDialog({
  document: doc,
  onClose,
  initialPage,
  highlight
}: {
  document: LexDocument;
  onClose: () => void;
  /**
   * The page to open at, 1-based. Set when the dialog was opened by following a citation: landing
   * on page 1 of a 200-page filing and asking the reader to scroll is not tracing a reference.
   */
  initialPage?: number | null;
  /** The cited text, shown above the page so the reader knows what they came here to check. */
  highlight?: string | null;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();

  const [url, setUrl] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());

  const isPdf =
    (doc.contentType ?? "").toLowerCase().includes("pdf") ||
    doc.filename.toLowerCase().endsWith(".pdf");
  const isImage = (doc.contentType ?? "").toLowerCase().startsWith("image/");

  useEffect(() => {
    let cancelled = false;
    let loaded: LoadedPdf | null = null;

    (async () => {
      try {
        const { url: signed } = await api.lex.documents.viewUrl(doc.id);
        if (cancelled) return;
        setUrl(signed);
        if (!isPdf) return;
        loaded = await loadPdf(signed);
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        setPdf(loaded.doc);
        setPageCount(loaded.doc.numPages);
      } catch (err) {
        if (!cancelled)
          toast({ title: errorMessage(err), variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // Release the worker and its rasterised pages; a 200-page PDF retains a lot of memory.
      void loaded?.destroy();
    };
  }, [doc.id, isPdf, toast]);

  /**
   * Registers each rendered page so the cited one can be scrolled to.
   *
   * A ref callback rather than an index lookup: PdfPage rasterises asynchronously, so the element
   * for page 6 exists before it has a height, and a scroll computed from the container would land
   * somewhere else once the pages above it grew.
   */
  const registerPage = useCallback(
    (pageNumber: number) => (el: HTMLDivElement | null) => {
      if (el) pageRefs.current.set(pageNumber, el);
      else pageRefs.current.delete(pageNumber);
    },
    []
  );

  const target = initialPage && initialPage > 0 ? initialPage : null;
  useEffect(() => {
    if (!target || loading) return;
    // Two frames, not one: the page element mounts empty and PdfPage sets its size when the canvas
    // paints, so a scroll on the first frame is measured against a zero-height page.
    const el = pageRefs.current.get(target);
    if (!el) return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        el.scrollIntoView({ block: "start", behavior: "auto" })
      )
    );
    return () => cancelAnimationFrame(raf);
  }, [target, loading, pageCount]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{doc.filename}</DialogTitle>
        </DialogHeader>

        {/* Why the reader is here. When the dialog was opened by following a reference, the quote
            is the thing being checked — showing it beside the page turns "is this the right pièce"
            into a comparison the reader can make without holding the sentence in their head. */}
        {highlight ? (
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              {t.lex.citedPassage}
              {target ? ` · ${t.lex.page} ${target}` : ""}
            </span>
            <p className="mt-1 italic">« {highlight} »</p>
          </div>
        ) : null}

        <div className="flex items-center gap-3 pb-2 border-b text-xs text-muted-foreground">
          <span>
            {doc.timelineDate ?? t.lex.noDate}
            {isPdf && pageCount > 0
              ? ` · ${pageCount} ${t.lex.pagesLabel}`
              : ""}
            {doc.language ? ` · ${doc.language.toUpperCase()}` : ""}
          </span>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              {t.lex.openOriginal}
            </a>
          ) : null}
        </div>

        <div className="max-h-[75vh] overflow-auto">
          {loading ? (
            <div className="py-16 flex justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : isPdf && pdf ? (
            <div className="flex flex-col items-center gap-3 pt-3">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map(
                (pageNumber) => (
                  <div
                    key={pageNumber}
                    ref={registerPage(pageNumber)}
                    className="w-full max-w-[720px]"
                  >
                    {/* The number is always visible, not only on the cited page: a reference reads
                        "p. 6" and a reader who cannot see which page they are looking at has to
                        count. */}
                    <div
                      className={`mb-1 text-[11px] ${
                        pageNumber === target
                          ? "font-medium text-primary"
                          : "text-muted-foreground"
                      }`}
                    >
                      {t.lex.page} {pageNumber}
                    </div>
                    <div
                      className={
                        pageNumber === target
                          ? "rounded-md ring-2 ring-primary/60"
                          : undefined
                      }
                    >
                      <PdfPage
                        doc={pdf}
                        pageNumber={pageNumber}
                        width={PAGE_WIDTH}
                      />
                    </div>
                  </div>
                )
              )}
            </div>
          ) : isImage && url ? (
            <img
              src={url}
              alt={doc.filename}
              className="max-w-full mx-auto pt-3"
            />
          ) : (
            <div className="py-10 space-y-3 text-center">
              <p className="text-sm text-muted-foreground">{t.lex.noPreview}</p>
              {doc.summary ? (
                <p className="text-sm text-left max-w-2xl mx-auto">
                  {doc.summary}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
