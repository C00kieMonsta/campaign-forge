import { useCallback, useEffect, useState } from "react";
import type {
  DataSnapshotInventory,
  LexPageIndexStatus
} from "@packages/types";
import { Button } from "@packages/ui";
import {
  Check,
  HardDriveDownload,
  Languages,
  ListOrdered,
  Loader2,
  RefreshCw
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import type { Language } from "@/i18n/translations";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errorMessage";

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "fr", label: "Français" },
  { value: "nl", label: "Nederlands" }
];

const PILL =
  "text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

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
  const [inventory, setInventory] = useState<DataSnapshotInventory | null>(
    null
  );
  const [checking, setChecking] = useState(false);
  const [preparing, setPreparing] = useState(false);

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

  const loadInventory = useCallback(async () => {
    setChecking(true);
    try {
      setInventory(await api.snapshot.inventory());
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
    } finally {
      setChecking(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  // Re-counted right before the ticket, not taken from the page: the server refuses a download
  // while a source is unreadable, and on a navigation that refusal would land as a bare JSON page
  // in place of the app. Checking here keeps it a toast.
  const handleDownloadSnapshot = async () => {
    setPreparing(true);
    try {
      const fresh = await api.snapshot.inventory();
      setInventory(fresh);
      if (fresh.errors.length > 0) {
        toast({ title: t.settings.snapshotBlocked, variant: "destructive" });
        return;
      }
      const { token } = await api.snapshot.downloadTicket();
      // A navigation, not a fetch: the browser streams the zip to disk, however large it is.
      const anchor = document.createElement("a");
      anchor.href = api.snapshot.downloadUrl(token);
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      toast({ title: t.settings.snapshotStarted });
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
    } finally {
      setPreparing(false);
    }
  };

  const lexRows = inventory
    ? inventory.postgres.tables.reduce((sum, table) => sum + table.rows, 0)
    : 0;

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

      <section className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-start gap-3">
          <HardDriveDownload className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="font-medium">{t.settings.snapshot}</h2>
            <p className="text-sm text-muted-foreground">
              {t.settings.snapshotHint}
            </p>
          </div>
        </div>

        {inventory ? (
          <div className="flex flex-wrap items-center gap-2">
            {inventory.dynamodb.map((table) => (
              <span
                key={table.tableName}
                className={`${PILL} bg-muted text-foreground`}
                title={table.tableName}
              >
                {table.items} · {t.settings.snapshotTables[table.logicalName]}
              </span>
            ))}
            {inventory.postgres.configured ? (
              <span
                className={`${PILL} bg-muted text-foreground`}
                title={inventory.postgres.tables
                  .map((table) => `${table.name}: ${table.rows}`)
                  .join("\n")}
              >
                {lexRows} · {t.settings.snapshotLexRows}
              </span>
            ) : (
              <span className={`${PILL} bg-muted text-muted-foreground`}>
                {t.settings.snapshotLexNotConfigured}
              </span>
            )}
            {inventory.s3.map((bucket) => (
              <span
                key={bucket.bucket}
                className={`${PILL} bg-muted text-foreground`}
                title={bucket.bucket}
              >
                {bucket.objects} {t.settings.snapshotFiles} ·{" "}
                {formatBytes(bucket.bytes)} ·{" "}
                {t.settings.snapshotBuckets[bucket.logicalName]}
              </span>
            ))}
          </div>
        ) : null}

        {inventory && inventory.errors.length > 0 ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              {t.settings.snapshotErrorsHint}
            </p>
            <ul className="space-y-1">
              {inventory.errors.map((error) => (
                <li key={error.source} className="text-xs min-w-0">
                  <span className="font-medium">{error.source}</span>{" "}
                  <span className="text-destructive break-words">
                    {error.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadInventory()}
            disabled={checking || preparing}
          >
            {checking ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {t.settings.snapshotRecheck}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleDownloadSnapshot()}
            disabled={
              preparing ||
              checking ||
              inventory === null ||
              inventory.errors.length > 0
            }
          >
            {preparing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <HardDriveDownload className="h-4 w-4 mr-2" />
            )}
            {t.settings.snapshotDownload}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {t.settings.snapshotQuiet}
        </p>
      </section>
    </div>
  );
}
