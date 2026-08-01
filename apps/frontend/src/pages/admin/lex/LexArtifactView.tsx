import { useCallback, useEffect, useState } from "react";
import type { LexArtifact, LexArtifactVersion } from "@packages/types";
import { Button } from "@packages/ui";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

export default function LexArtifactView() {
  const { id = "" } = useParams();
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [artifact, setArtifact] = useState<LexArtifact | null>(null);
  const [version, setVersion] = useState<LexArtifactVersion | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { artifact, version } = await api.lex.artifacts.get(id);
      setArtifact(artifact);
      setVersion(version);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const verified = version?.verificationStatus === "verified";
  const signedOff = Boolean(version?.signedOffAt);

  const handleSignOff = async () => {
    setBusy(true);
    try {
      const { artifact, version } = await api.lex.artifacts.signoff(id);
      setArtifact(artifact);
      setVersion(version);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (verifiedOnly: boolean) => {
    setBusy(true);
    try {
      const html = await api.lex.artifacts.exportHtml(id, verifiedOnly);
      const w = window.open("", "_blank");
      if (!w) {
        toast({ title: "Popup blocked", variant: "destructive" });
        return;
      }
      w.document.write(html);
      w.document.close();
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t.lex.confirmDelete)) return;
    try {
      await api.lex.artifacts.delete(id);
      navigate(
        artifact ? `/lex/workspaces/${artifact.workspaceId}/artifacts` : "/lex"
      );
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="p-12 text-center text-muted-foreground flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (!artifact || !version) return null;

  const claims = version.bodyJson?.claims ?? [];
  const report = version.verificationReport;
  // Absent on versions generated before sources were recorded, and on manual edits.
  const sources = report?.sources ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button
        onClick={() =>
          navigate(`/lex/workspaces/${artifact.workspaceId}/artifacts`)
        }
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" />
        {t.lex.back}
      </button>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-serif font-bold truncate">
            {artifact.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {artifact.type} · v{version.version}
          </p>
        </div>
        <button
          onClick={handleDelete}
          aria-label={t.lex.deleteArtifact}
          className="text-muted-foreground hover:text-destructive shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Verification banner */}
      <div
        className={`rounded-xl border p-3 text-sm flex items-center gap-2 ${
          verified
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-amber-50 border-amber-200 text-amber-800"
        }`}
      >
        {verified ? <ShieldCheck className="h-4 w-4" /> : null}
        <span>
          {verified ? t.lex.verified : t.lex.verificationFailed}
          {report
            ? ` — ${report.supported}/${report.total} ${t.lex.claimsSupported}`
            : ""}
          {signedOff ? ` · ${t.lex.signedOff}` : ""}
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleSignOff}
          disabled={busy || !verified || signedOff}
          className="gradient-terracotta text-white"
        >
          <CheckCircle2 className="h-4 w-4 mr-2" />
          {signedOff ? t.lex.signedOff : t.lex.signOff}
        </Button>
        <Button
          variant="outline"
          onClick={() => handleExport(true)}
          disabled={busy}
        >
          <Download className="h-4 w-4 mr-2" />
          {t.lex.exportForFiling}
        </Button>
        <Button
          variant="outline"
          onClick={() => handleExport(false)}
          disabled={busy}
        >
          <Download className="h-4 w-4 mr-2" />
          {t.lex.exportDraft}
        </Button>
      </div>

      {/* What the draft was written FROM.
          Distinct from the citations below, and the difference is the point: this is what the
          drafter was SHOWN, the citations are what survived verification. A pièce listed here with
          no citation under it either had nothing to say or was missed — and only this list makes
          that visible. */}
      {sources.length > 0 ? (
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">{t.lex.sourcesUsed}</h2>
            <span className="text-xs text-muted-foreground">
              {report?.sourceMode === "full"
                ? t.lex.readingFull
                : t.lex.readingSampled}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t.lex.sourcesUsedHint}
          </p>
          <ul className="text-xs divide-y">
            {sources.map((s) => (
              <li key={s.documentId} className="flex gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate" title={s.filename}>
                  {s.filename}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {t.lex.passagesCount.replace("{n}", String(s.passages))}
                </span>
              </li>
            ))}
          </ul>
          {report?.truncated ? (
            <p className="text-xs text-amber-700">{t.lex.sourcesTruncated}</p>
          ) : null}
        </div>
      ) : null}

      {/* Claims */}
      <div className="space-y-3">
        {claims.map((c) => (
          <div key={c.claimId} className="rounded-xl border bg-card p-4">
            <p className="text-sm whitespace-pre-wrap">{c.text}</p>
            {c.status === "supported" && c.citation ? (
              <div
                className="mt-2 text-xs text-muted-foreground"
                title={c.citation.quote}
              >
                <span className="px-2 py-0.5 rounded-full bg-muted">
                  {c.citation.filename}
                  {c.citation.pageFrom ? `, p.${c.citation.pageFrom}` : ""}
                </span>
              </div>
            ) : (
              <div className="mt-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                  {t.lex.unsupportedClaim}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
