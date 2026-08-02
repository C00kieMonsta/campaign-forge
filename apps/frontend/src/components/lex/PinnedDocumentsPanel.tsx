import { useCallback, useEffect, useState } from "react";
import type { LexDocument } from "@packages/types";
import { Button } from "@packages/ui";
import { CheckSquare, Loader2, Send, Square, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errorMessage";
import { loadPdf, type LoadedPdf, type PdfDocument } from "./pdf";
import { PdfPage } from "./PdfPage";

// Rendered page width inside the panel. Wide enough to read a scanned filing's headings; the
// panel itself is the constraint, and the sidebar collapses when more room is needed.
const PAGE_WIDTH = 360;

/**
 * The pinned-documents panel: several documents held open as tabs, on the right, next to the
 * conversation.
 *
 * This is the "keep it in front of me while I work" surface, distinct from the modal viewer
 * (which is for a quick look). Scroll a pinned document, tick the pages that matter, and send
 * those pages to the chat — they become structured pins that constrain retrieval to exactly
 * those pages.
 *
 * Only the ACTIVE tab's PDF is loaded. Pinning eight documents must not mean eight pdf.js workers
 * and eight sets of rasterised pages in memory.
 */
export default function PinnedDocumentsPanel({
  docs,
  activeId,
  onActivate,
  onClose,
  onSendToChat
}: {
  docs: LexDocument[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onSendToChat: (doc: LexDocument, pages: number[]) => void;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();

  const active = docs.find((d) => d.id === activeId) ?? docs[0] ?? null;
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  // Selection is kept per document so switching tabs and coming back does not lose the picks.
  const [selectedByDoc, setSelectedByDoc] = useState<Record<string, number[]>>(
    {}
  );

  const selected = active ? (selectedByDoc[active.id] ?? []) : [];
  const isPdf =
    !!active &&
    ((active.contentType ?? "").toLowerCase().includes("pdf") ||
      active.filename.toLowerCase().endsWith(".pdf"));

  useEffect(() => {
    if (!active) {
      setPdf(null);
      setPageCount(0);
      return;
    }
    let cancelled = false;
    let loaded: LoadedPdf | null = null;
    setPdf(null);
    setPageCount(0);
    setLoading(true);

    (async () => {
      try {
        const { url } = await api.lex.documents.viewUrl(active.id);
        if (cancelled) return;
        if (!isPdf) return;
        loaded = await loadPdf(url);
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
      void loaded?.destroy();
    };
  }, [active, isPdf, toast]);

  const togglePage = useCallback(
    (page: number) => {
      if (!active) return;
      setSelectedByDoc((prev) => {
        const current = prev[active.id] ?? [];
        return {
          ...prev,
          [active.id]: current.includes(page)
            ? current.filter((p) => p !== page)
            : [...current, page].sort((a, b) => a - b)
        };
      });
    },
    [active]
  );

  const selectAll = () => {
    if (!active) return;
    setSelectedByDoc((prev) => ({
      ...prev,
      [active.id]:
        selected.length === pageCount
          ? []
          : Array.from({ length: pageCount }, (_, i) => i + 1)
    }));
  };

  const send = () => {
    if (!active) return;
    onSendToChat(active, selected);
    // Clear after sending: the pages are now attached to the question being composed, and leaving
    // them ticked makes it ambiguous whether they are still pending.
    setSelectedByDoc((prev) => ({ ...prev, [active.id]: [] }));
  };

  if (docs.length === 0) return null;

  return (
    <aside
      aria-label={t.lex.pinned}
      className="w-[25rem] shrink-0 flex flex-col border-l bg-muted/20"
    >
      {/* Tab bar — one tab per pinned document, closable. */}
      <div className="flex items-stretch gap-px overflow-x-auto border-b bg-muted/40">
        {docs.map((doc) => {
          const isActive = doc.id === active?.id;
          return (
            <div
              key={doc.id}
              className={`group/tab flex items-center gap-1 px-2 py-1.5 max-w-[12rem] shrink-0 border-b-2 ${
                isActive
                  ? "border-sidebar-primary bg-background"
                  : "border-transparent hover:bg-background/60"
              }`}
            >
              <button
                onClick={() => onActivate(doc.id)}
                title={doc.filename}
                className="truncate text-xs min-w-0"
              >
                {doc.filename}
              </button>
              <button
                onClick={() => onClose(doc.id)}
                aria-label={t.lex.unpin}
                title={t.lex.unpin}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Selection toolbar */}
      {active ? (
        <div className="flex items-center gap-2 border-b px-2 py-1.5 bg-background">
          {isPdf && pageCount > 0 ? (
            <>
              <button
                onClick={selectAll}
                title={t.lex.selectAllPages}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {selected.length === pageCount ? (
                  <CheckSquare className="h-3.5 w-3.5" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {selected.length > 0
                  ? `${selected.length}/${pageCount}`
                  : t.lex.selectAllPages}
              </button>
              <span className="text-[11px] text-muted-foreground truncate">
                {selected.length > 0
                  ? `p. ${selected.join(", ")}`
                  : t.lex.clickPagesToSelect}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground truncate">
              {t.lex.noPreview}
            </span>
          )}
          <Button
            size="sm"
            onClick={send}
            title={t.lex.sendToChat}
            className="ml-auto shrink-0 gradient-terracotta text-white h-7 px-2 text-xs"
          >
            <Send className="h-3 w-3 mr-1" />
            {t.lex.sendToChat}
          </Button>
        </div>
      ) : null}

      {/* Continuous page scroll */}
      <div className="flex-1 overflow-auto p-2">
        {loading ? (
          <div className="py-12 flex justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isPdf && pdf ? (
          <div className="space-y-2">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
              <PdfPage
                key={`${active?.id}-${page}`}
                doc={pdf}
                pageNumber={page}
                width={PAGE_WIDTH}
                selected={selected.includes(page)}
                onToggle={togglePage}
                selectLabel={t.lex.page}
              />
            ))}
          </div>
        ) : (
          <div className="py-8 px-2 space-y-2 text-center">
            <p className="text-xs text-muted-foreground">{t.lex.noPreview}</p>
            {active?.summary ? (
              <p className="text-xs text-left text-muted-foreground">
                {active.summary}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
