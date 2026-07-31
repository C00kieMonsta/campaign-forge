import { useEffect, useState } from "react";
import type { LexDocument } from "@packages/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@packages/ui";
import { Download, Loader2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
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
  onClose
}: {
  document: LexDocument;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();

  const [url, setUrl] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);

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
        if (!cancelled) toast({ title: String(err), variant: "destructive" });
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{doc.filename}</DialogTitle>
        </DialogHeader>

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
                  <div key={pageNumber} className="w-full max-w-[720px]">
                    <PdfPage
                      doc={pdf}
                      pageNumber={pageNumber}
                      width={PAGE_WIDTH}
                    />
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
