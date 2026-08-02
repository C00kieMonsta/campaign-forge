import { useCallback, useEffect, useState } from "react";
import type { LexArtifact, LexArtifactType } from "@packages/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea
} from "@packages/ui";
import { ArrowLeft, FileText, Loader2, Plus } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

function StatusBadge({ status }: { status: LexArtifact["status"] }) {
  const base = "text-xs px-2 py-0.5 rounded-full";
  if (status === "verified" || status === "final")
    return (
      <span className={`${base} bg-green-100 text-green-700`}>{status}</span>
    );
  return (
    <span className={`${base} bg-amber-100 text-amber-700`}>{status}</span>
  );
}

export default function LexArtifacts() {
  const { id: workspaceId = "" } = useParams();
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [items, setItems] = useState<LexArtifact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<LexArtifactType>("memo");
  const [instructions, setInstructions] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { items } = await api.lex.artifacts.list(workspaceId);
      setItems(items);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = async () => {
    if (!title.trim() || isGenerating) return;
    setIsGenerating(true);
    try {
      // Queued, not awaited — same reason as the composer's dialog: drafting plus one judge call
      // per claim outlives nginx's default 60s read timeout on this route. No conversation is named
      // here, so the server creates one for the run to report into.
      await api.lex.tasks.create({
        workspaceId,
        kind: "generate_artifact",
        title: title.trim(),
        instructions: instructions.trim() || undefined,
        params: { type }
      });
      setDialogOpen(false);
      setTitle("");
      setInstructions("");
      toast({ title: t.lex.generationQueued });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button
        onClick={() => navigate(`/lex/workspaces/${workspaceId}`)}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" />
        {t.lex.back}
      </button>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-serif font-bold">{t.lex.artifacts}</h1>
        <Button
          onClick={() => setDialogOpen(true)}
          className="gradient-terracotta text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t.lex.newArtifact}
        </Button>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground">
          {t.lex.noArtifacts}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <button
              key={a.id}
              onClick={() => navigate(`/lex/artifacts/${a.id}`)}
              className="w-full text-left rounded-xl border bg-card p-4 hover:shadow-sm transition-shadow flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate font-medium">{a.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {a.type}
                </span>
              </span>
              <StatusBadge status={a.status} />
            </button>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.lex.newArtifact}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t.lex.artifactType}</Label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as LexArtifactType)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="memo">{t.lex.typeMemo}</option>
                <option value="chronology">{t.lex.typeChronology}</option>
                <option value="submission">{t.lex.typeSubmission}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t.lex.artifactTitle}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>{t.lex.instructions}</Label>
              <Textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={t.lex.instructionsPlaceholder}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isGenerating}
            >
              {t.lex.cancel}
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !title.trim()}
              className="gradient-terracotta text-white hover:opacity-90"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {isGenerating ? t.lex.generating : t.lex.generate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
