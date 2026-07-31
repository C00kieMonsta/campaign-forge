import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { LexDocument, LexWorkspace } from "@packages/types";
import { Button, Input } from "@packages/ui";
import {
  ArrowLeft,
  FileSignature,
  FileText,
  Loader2,
  MessageSquare,
  Search,
  Trash2,
  Upload
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { toUploadCandidates, uploadDocuments } from "@/lib/uploadDocuments";

const IN_PROGRESS: ReadonlySet<LexDocument["parseStatus"]> = new Set([
  "uploaded",
  "parsing",
  "chunking",
  "embedding",
  "summarizing"
]);

const StatusBadge = memo(function StatusBadge({
  status
}: {
  status: LexDocument["parseStatus"];
}) {
  const base =
    "text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1";
  if (status === "ready")
    return <span className={`${base} bg-green-100 text-green-700`}>ready</span>;
  if (status === "failed")
    return <span className={`${base} bg-red-100 text-red-700`}>failed</span>;
  if (status === "needs_ocr")
    return (
      <span className={`${base} bg-amber-100 text-amber-700`}>needs OCR</span>
    );
  return (
    <span className={`${base} bg-blue-100 text-blue-700`}>
      <Loader2 className="h-3 w-3 animate-spin" />
      {status}
    </span>
  );
});

export default function LexWorkspace() {
  const { id = "" } = useParams();
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [workspace, setWorkspace] = useState<LexWorkspace | null>(null);
  const [docs, setDocs] = useState<LexDocument[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  const loadTimeline = useCallback(async () => {
    const { items } = await api.lex.workspaces.timeline(id);
    setDocs(items);
    return items;
  }, [id]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { workspace: ws } = await api.lex.workspaces.get(id);
      setWorkspace(ws);
      await loadTimeline();
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [id, loadTimeline, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll the timeline while any document is still being ingested.
  useEffect(() => {
    const anyInProgress = docs.some((d) => IN_PROGRESS.has(d.parseStatus));
    if (anyInProgress && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        try {
          const items = await loadTimeline();
          if (
            !items.some((d) => IN_PROGRESS.has(d.parseStatus)) &&
            pollRef.current
          ) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch {
          // ignore transient polling errors
        }
      }, 4000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [docs, loadTimeline]);

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    try {
      // Direct-to-S3, same path as the chat's documents panel.
      await uploadDocuments(id, toUploadCandidates([file]));
      await loadTimeline();
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  // Search over what a lawyer actually remembers about a document: its name, a party, a topic,
  // or roughly when it is from. The backend timeline is already chronological, so the filter
  // preserves that order.
  const needle = query.trim().toLowerCase();
  const visibleDocs = needle
    ? docs.filter(
        (d) =>
          d.filename.toLowerCase().includes(needle) ||
          (d.timelineDate ?? "").includes(needle) ||
          d.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
          d.keyNames.some((name) => name.toLowerCase().includes(needle))
      )
    : docs;

  const handleDelete = async (docId: string) => {
    if (!window.confirm(t.lex.confirmDelete)) return;
    try {
      await api.lex.documents.delete(docId);
      setDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back to the chat, which is the workspace's home. */}
      <button
        onClick={() => navigate(`/lex/workspaces/${id}`)}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" />
        {t.lex.back}
      </button>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-serif font-bold truncate">
            {workspace?.name ?? t.lex.title}
          </h1>
          {workspace?.description ? (
            <p className="text-sm text-muted-foreground">
              {workspace.description}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          onClick={() => navigate(`/lex/workspaces/${id}`)}
          className="shrink-0"
        >
          <MessageSquare className="h-4 w-4 mr-2" />
          {t.lex.chat}
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate(`/lex/workspaces/${id}/artifacts`)}
          className="shrink-0"
        >
          <FileSignature className="h-4 w-4 mr-2" />
          {t.lex.openArtifacts}
        </Button>
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="gradient-terracotta text-white shrink-0"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          {isUploading ? t.lex.uploading : t.lex.uploadDocument}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-4 mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t.lex.timeline}
          </h2>
          <div className="relative w-72 max-w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.lex.searchDocuments}
              className="h-9 pl-8 text-sm"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : visibleDocs.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {docs.length === 0 ? t.lex.noDocuments : t.lex.noSearchResults}
          </div>
        ) : (
          <ol className="relative border-l border-border ml-2 space-y-4">
            {visibleDocs.map((d) => (
              <li key={d.id} className="ml-4">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-sidebar-primary" />
                <div className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">
                        {d.timelineDate ?? t.lex.noDate}
                      </div>
                      <div className="font-medium flex items-center gap-2 truncate">
                        <FileText className="h-4 w-4 shrink-0" />
                        {d.filename}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={d.parseStatus} />
                      <button
                        onClick={() => handleDelete(d.id)}
                        aria-label={t.lex.delete}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {d.summary ? (
                    <p className="text-sm text-muted-foreground mt-2">
                      {d.summary}
                    </p>
                  ) : d.parseStatus === "failed" && d.error ? (
                    <p className="text-sm text-destructive mt-2">{d.error}</p>
                  ) : null}
                  {/* Tags from ingestion — also what the search box matches on. */}
                  {d.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {d.tags.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setQuery(tag)}
                          title={t.lex.searchDocuments}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:text-foreground"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
