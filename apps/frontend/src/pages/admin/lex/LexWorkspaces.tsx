import { useCallback, useEffect, useState } from "react";
import type { LexWorkspace } from "@packages/types";
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
import { Loader2, Plus, Scale, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

export default function LexWorkspaces() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [workspaces, setWorkspaces] = useState<LexWorkspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { items } = await api.lex.workspaces.list();
      setWorkspaces(items);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsCreating(true);
    try {
      const { workspace } = await api.lex.workspaces.create({
        name: name.trim(),
        description: description.trim() || undefined
      });
      setDialogOpen(false);
      setName("");
      setDescription("");
      navigate(`/lex/workspaces/${workspace.id}`);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.lex.confirmDelete)) return;
    try {
      await api.lex.workspaces.delete(id);
      setWorkspaces((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <Scale className="h-6 w-6" />
            {t.lex.title}
          </h1>
          <p className="text-sm text-muted-foreground">{t.lex.subtitle}</p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="gradient-terracotta text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t.lex.newWorkspace}
        </Button>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-4">
          <span>{t.lex.noWorkspaces}</span>
          <Button
            onClick={() => setDialogOpen(true)}
            className="gradient-terracotta text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t.lex.newWorkspace}
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((w) => (
            <div
              key={w.id}
              className="rounded-xl border bg-card p-4 hover:shadow-sm transition-shadow flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  onClick={() => navigate(`/lex/workspaces/${w.id}`)}
                  className="text-left font-medium hover:underline"
                >
                  {w.name}
                </button>
                <button
                  onClick={() => handleDelete(w.id)}
                  aria-label={t.lex.deleteWorkspace}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {w.description ? (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {w.description}
                </p>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="mt-auto w-fit"
                onClick={() => navigate(`/lex/workspaces/${w.id}`)}
              >
                {t.lex.openWorkspace}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.lex.newWorkspace}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t.lex.workspaceName}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>{t.lex.description}</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t.lex.cancel}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isCreating || !name.trim()}
              className="gradient-terracotta text-white hover:opacity-90"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t.lex.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
