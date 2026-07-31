import { useCallback, useEffect, useState } from "react";
import type { LexPageIndexStatus } from "@packages/types";
import { Button } from "@packages/ui";
import {
  Check,
  Languages,
  ListOrdered,
  Loader2,
  RefreshCw
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import type { Language } from "@/i18n/translations";
import { api } from "@/lib/api";

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "fr", label: "Français" },
  { value: "nl", label: "Nederlands" }
];

const PILL =
  "text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1";

/**
 * Settings. One pinned language drives the interface AND the assistant: the backend reads it to
 * pin chat replies, rolling conversation summaries, generated drafts and document summaries, so
 * the whole product speaks one language instead of drifting.
 */
export default function Settings() {
  const { language, setLanguage, t } = useLanguage();
  const { toast } = useToast();
  const [resummarizing, setResummarizing] = useState(false);
  const [pageIndex, setPageIndex] = useState<LexPageIndexStatus | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const loadPageIndex = useCallback(async () => {
    try {
      setPageIndex(await api.lex.documents.pageIndexStatus());
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    void loadPageIndex();
  }, [loadPageIndex]);

  // The rebuild is drained by the ingestion worker, so the counts move well after the click.
  // Poll on `queued` — jobs actually in flight — NOT on `pending`, which counts un-indexed
  // documents and is therefore non-zero before anything has been asked for: polling on it would
  // spin a "working" indicator over an idle worker from the moment the page mounts, forever.
  useEffect(() => {
    if (!pageIndex?.queued) return;
    const timer = setInterval(() => {
      api.lex.documents
        .pageIndexStatus()
        .then(setPageIndex)
        .catch(() => {
          /* transient */
        });
    }, 5000);
    return () => clearInterval(timer);
  }, [pageIndex?.pending]);

  // Changing the language only affects documents summarized from here on; existing summaries
  // keep whatever language they were written in until they are refreshed.
  const handleResummarize = async () => {
    setResummarizing(true);
    try {
      const { queued } = await api.lex.documents.resummarizeAll();
      toast({
        title:
          queued === 0
            ? t.settings.resummarizeNone
            : `${t.settings.resummarizeQueued} (${queued})`
      });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setResummarizing(false);
    }
  };

  // Free by construction: the worker re-reads the text from the stored file and rewrites only the
  // page rows. Nothing is re-embedded or re-summarized, so this button costs nothing to press.
  const handleRebuildPageIndex = async () => {
    setRebuilding(true);
    try {
      const { queued } = await api.lex.documents.rebuildPageIndex();
      toast({
        title:
          queued === 0
            ? t.settings.pageIndexNone
            : `${t.settings.pageIndexQueued} (${queued})`
      });
      await loadPageIndex();
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold">{t.settings.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t.settings.subtitle}
        </p>
      </div>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Languages className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="font-medium">{t.settings.language}</h2>
            <p className="text-sm text-muted-foreground">
              {t.settings.languageHint}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {LANGUAGES.map((lang) => {
            const active = language === lang.value;
            return (
              <button
                key={lang.value}
                onClick={() => setLanguage(lang.value)}
                aria-pressed={active}
                className={`w-full flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                  active
                    ? "border-sidebar-primary bg-muted"
                    : "hover:bg-muted/50"
                }`}
              >
                <span className="font-medium">{lang.label}</span>
                {active ? (
                  <Check className="h-4 w-4 text-sidebar-primary shrink-0" />
                ) : null}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {t.settings.quotesStayVerbatim}
        </p>
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-start gap-3">
          <RefreshCw className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="font-medium">{t.settings.existingDocuments}</h2>
            <p className="text-sm text-muted-foreground">
              {t.settings.existingDocumentsHint}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleResummarize()}
          disabled={resummarizing}
        >
          {resummarizing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {t.settings.resummarize}
        </Button>
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-start gap-3">
          <ListOrdered className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="font-medium">{t.settings.pageIndex}</h2>
            <p className="text-sm text-muted-foreground">
              {t.settings.pageIndexHint}
            </p>
          </div>
        </div>

        {pageIndex ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${PILL} bg-green-100 text-green-700`}>
              {pageIndex.indexed} · {t.settings.pageIndexIndexed}
            </span>
            {pageIndex.queued > 0 ? (
              <span className={`${PILL} bg-blue-100 text-blue-700`}>
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                {pageIndex.queued} · {t.settings.pageIndexQueuedNow}
              </span>
            ) : null}
            {pageIndex.pending > 0 ? (
              <span className={`${PILL} bg-amber-100 text-amber-700`}>
                {pageIndex.pending} · {t.settings.pageIndexPending}
              </span>
            ) : null}
            {pageIndex.blocked > 0 ? (
              <span className={`${PILL} bg-red-100 text-red-700`}>
                {pageIndex.blocked} · {t.settings.pageIndexBlocked}
              </span>
            ) : null}
          </div>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleRebuildPageIndex()}
          disabled={rebuilding}
        >
          {rebuilding ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ListOrdered className="h-4 w-4 mr-2" />
          )}
          {t.settings.pageIndexRebuild}
        </Button>

        {pageIndex && pageIndex.blockedDocuments.length > 0 ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              {t.settings.pageIndexBlockedHint}
            </p>
            <ul className="space-y-2">
              {pageIndex.blockedDocuments.map((d) => (
                <li key={d.documentId} className="text-xs min-w-0">
                  <span
                    className="font-medium block truncate"
                    title={d.filename}
                  >
                    {d.filename}
                  </span>
                  {/* Shown in full, not truncated: the reason is the whole reason this list exists. */}
                  <span className="text-destructive break-words">
                    {d.error}
                  </span>
                </li>
              ))}
            </ul>
            {pageIndex.blockedTruncated ? (
              <p className="text-xs text-muted-foreground">
                {t.settings.pageIndexBlockedTruncated}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
