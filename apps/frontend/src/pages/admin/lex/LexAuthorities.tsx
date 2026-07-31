import { useCallback, useEffect, useRef, useState } from "react";
import type { LexAuthority } from "@packages/types";
import { Button, Input } from "@packages/ui";
import {
  Landmark,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/store/hooks";
import { useLexControllers } from "@/store/LexStoreProvider";

// Statuses that mean ingestion is still working — poll until they settle.
const IN_PROGRESS: ReadonlySet<LexAuthority["status"]> = new Set([
  "uploaded",
  "parsing",
  "chunking",
  "embedding",
  "digesting"
]);

function StatusBadge({ status }: { status: LexAuthority["status"] }) {
  const base =
    "text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1";
  if (status === "ready")
    return <span className={`${base} bg-green-100 text-green-700`}>ready</span>;
  if (status === "failed")
    return <span className={`${base} bg-red-100 text-red-700`}>failed</span>;
  return (
    <span className={`${base} bg-blue-100 text-blue-700`}>
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
      {status}
    </span>
  );
}

/**
 * The authorities library: law the assistant treats as non-negotiable truth.
 *
 * Owner-scoped, so this sits outside any workspace — a code of law applies to every case. Each
 * entry can be disabled to keep it stored and searchable but out of the prompt, and shows what
 * its digest costs per request, because that cost is paid on every single chat turn.
 */
export default function LexAuthorities() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const controllers = useLexControllers();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authorities = useCollection("lexAuthorities");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      await controllers.authorities.loadAll();
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [controllers, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // A 700-page code takes minutes to chunk, embed and digest.
  const anyInProgress = authorities.some((a) => IN_PROGRESS.has(a.status));
  useEffect(() => {
    if (!anyInProgress) return;
    const timer = setInterval(() => {
      controllers.authorities.loadAll().catch(() => {
        /* transient */
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [anyInProgress, controllers]);

  const handleUpload = async (files: FileList) => {
    setUploading(true);
    try {
      const { failed } = await controllers.authorities.upload(
        Array.from(files)
      );
      if (failed.length > 0) {
        toast({
          title: `${t.lex.uploadPartial} — ${failed.join(", ")}`,
          variant: "destructive"
        });
      }
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const commitTitle = async () => {
    if (!editing) return;
    const { id, title } = editing;
    setEditing(null);
    if (!title.trim()) return;
    try {
      await controllers.authorities.update(id, { title: title.trim() });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  const enabledTokens = authorities
    .filter((a) => a.enabled && a.status === "ready")
    .reduce((sum, a) => sum + (a.digestTokens ?? 0), 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <Landmark className="h-6 w-6" />
            {t.lex.authorities}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t.lex.authoritiesHint}
          </p>
        </div>
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="gradient-terracotta text-white shrink-0"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          {uploading ? t.lex.uploading : t.lex.addAuthority}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {enabledTokens > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t.lex.authoritiesBudget.replace(
            "{tokens}",
            enabledTokens.toLocaleString()
          )}
        </p>
      ) : null}

      {loading ? (
        <div className="p-12 flex justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : authorities.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground text-sm">
          {t.lex.noAuthorities}
        </div>
      ) : (
        <ul className="space-y-2">
          {authorities.map((a) => (
            <li key={a.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {editing?.id === a.id ? (
                    <Input
                      value={editing.title}
                      autoFocus
                      onChange={(e) =>
                        setEditing({ id: a.id, title: e.target.value })
                      }
                      onBlur={() => void commitTitle()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitTitle();
                        }
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="h-8 font-medium"
                    />
                  ) : (
                    <button
                      onClick={() => setEditing({ id: a.id, title: a.title })}
                      className="group/t flex items-center gap-2 text-left min-w-0 max-w-full"
                    >
                      <span className="font-medium truncate">{a.title}</span>
                      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover/t:opacity-100" />
                    </button>
                  )}
                  <div className="text-xs text-muted-foreground mt-1 truncate">
                    {a.filename}
                    {a.articleCount > 0
                      ? ` · ${a.articleCount} ${t.lex.articles}`
                      : ""}
                    {a.language ? ` · ${a.language.toUpperCase()}` : ""}
                    {a.digestTokens
                      ? ` · ~${a.digestTokens.toLocaleString()} tokens`
                      : ""}
                  </div>
                  {a.status === "failed" && a.error ? (
                    <p className="text-xs text-destructive mt-1">{a.error}</p>
                  ) : null}
                </div>
                <StatusBadge status={a.status} />
              </div>

              <div className="mt-3 flex items-center gap-3 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    disabled={a.status !== "ready"}
                    onChange={(e) =>
                      void act(() =>
                        controllers.authorities.setEnabled(
                          a.id,
                          e.target.checked
                        )
                      )
                    }
                  />
                  {t.lex.authorityEnabled}
                </label>
                {a.status === "failed" ? (
                  <button
                    onClick={() =>
                      void act(() => controllers.authorities.retry(a.id))
                    }
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {t.lex.retry}
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    if (!window.confirm(t.lex.confirmDelete)) return;
                    void act(() => controllers.authorities.remove(a.id));
                  }}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive ml-auto"
                >
                  <Trash2 className="h-3 w-3" />
                  {t.lex.delete}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
