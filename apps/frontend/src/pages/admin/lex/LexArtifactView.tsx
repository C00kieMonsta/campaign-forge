import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LexArtifact,
  LexArtifactBody,
  LexArtifactClaim,
  LexArtifactVersion,
  LexClaimKind,
  LexDocument,
  LexTask
} from "@packages/types";
import { Button, Textarea } from "@packages/ui";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSearch,
  Loader2,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import DocumentViewerDialog from "@/components/lex/DocumentViewerDialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errorMessage";

/** How often a running re-verification is polled. Same cadence as the task panel. */
const POLL_MS = 3000;

const KINDS: LexClaimKind[] = ["assertion", "argument", "relief", "heading"];

/**
 * A claim's kind decides whether it is checked against the file at all, so it is editable.
 *
 * This is the escape hatch for the case that had no answer before: a sentence the drafter wrote as
 * a factual assertion but which is really a request to the court could only ever come back
 * unsupported, and its presence kept the whole document out of the filing path. Re-labelling it is
 * the correct fix, and it is the lawyer's call to make — she is the one signing the document.
 */
function kindLabel(t: ReturnType<typeof useLanguage>["t"], kind: LexClaimKind) {
  return t.lex.claimKind[kind];
}

export default function LexArtifactView() {
  const { id = "" } = useParams();
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [artifact, setArtifact] = useState<LexArtifact | null>(null);
  const [version, setVersion] = useState<LexArtifactVersion | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  /** The working copy while editing. null = not editing, which is also the read-only state. */
  const [draft, setDraft] = useState<LexArtifactClaim[] | null>(null);
  /**
   * Cited claims deleted in this editing session.
   *
   * Tracked separately and sent with the save because the server refuses to drop a cited claim
   * unless it is named — a citation vanishing from a court draft in silence is the one edit that
   * must not be possible. Naming them here is the deliberate acknowledgement.
   */
  const [droppedCited, setDroppedCited] = useState<string[]>([]);

  /** The running re-verification, polled until it finishes. */
  const [verifyTask, setVerifyTask] = useState<LexTask | null>(null);

  // The pièces, so a citation can be opened at its page. Fetched for this workspace once the
  // artifact is known — a reference that cannot be followed is not a reference.
  const [documents, setDocuments] = useState<LexDocument[]>([]);
  const [tracing, setTracing] = useState<{
    document: LexDocument;
    pageFrom: number | null;
    quote: string;
  } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { artifact, version } = await api.lex.artifacts.get(id);
      setArtifact(artifact);
      setVersion(version);
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const workspaceId = artifact?.workspaceId;
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    api.lex.documents
      .list(workspaceId)
      .then(({ items }) => {
        if (!cancelled) setDocuments(items);
      })
      .catch(() => {
        // Non-fatal: the claims still render, their citations just cannot be opened. The chip
        // reports that itself rather than failing silently on click.
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Poll the re-verification until it lands, then reload the document to show the new verdicts.
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!verifyTask) return;
    if (verifyTask.status === "done" || verifyTask.status === "failed") return;
    pollRef.current = window.setTimeout(async () => {
      try {
        const { task } = await api.lex.tasks.get(verifyTask.id);
        setVerifyTask(task);
        if (task.status === "done") {
          await load();
          toast({ title: t.lex.reverifyDone });
        }
        if (task.status === "failed") {
          toast({
            title: task.error ?? t.lex.reverifyFailed,
            variant: "destructive"
          });
        }
      } catch {
        // A failed poll is not a failed run: keep the panel and try again on the next tick.
      }
    }, POLL_MS);
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [verifyTask, load, toast, t]);

  const verified = version?.verificationStatus === "verified";
  const unverified = version?.verificationStatus === "unverified";
  const signedOff = Boolean(version?.signedOffAt);
  const editing = draft !== null;
  const verifying =
    verifyTask?.status === "queued" || verifyTask?.status === "running";

  const handleSignOff = async () => {
    setBusy(true);
    try {
      const { artifact, version } = await api.lex.artifacts.signoff(id);
      setArtifact(artifact);
      setVersion(version);
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
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
      toast({ title: errorMessage(err), variant: "destructive" });
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
      toast({ title: errorMessage(err), variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const body: LexArtifactBody = { type: "lex-artifact", claims: draft };
      const { artifact, version } = await api.lex.artifacts.save(id, {
        bodyJson: body,
        dropCitedClaimIds: droppedCited
      });
      setArtifact(artifact);
      setVersion(version);
      setDraft(null);
      setDroppedCited([]);
      toast({ title: t.lex.savedNeedsReverify });
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Queues a re-verification.
   *
   * A background task rather than a request, for the reason drafting is one: it is a frontier-model
   * judge per claim it has to re-check, which outlives the 60s proxy timeout.
   */
  const handleReverify = async () => {
    if (!artifact) return;
    setBusy(true);
    try {
      const { task } = await api.lex.tasks.create({
        workspaceId: artifact.workspaceId,
        kind: "verify_artifact",
        title: artifact.title,
        params: { artifactId: artifact.id }
      });
      setVerifyTask(task);
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const trace = useCallback(
    (documentId: string, pageFrom: number | null, quote: string) => {
      const target = documents.find((d) => d.id === documentId);
      if (!target) {
        toast({ title: t.lex.sourceUnavailable, variant: "destructive" });
        return;
      }
      setTracing({ document: target, pageFrom, quote });
    },
    [documents, t, toast]
  );

  const claims = useMemo(
    () => draft ?? version?.bodyJson?.claims ?? [],
    [draft, version]
  );

  if (isLoading) {
    return (
      <div className="p-12 text-center text-muted-foreground flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (!artifact || !version) return null;

  const report = version.verificationReport;
  // Absent on versions generated before sources were recorded.
  const sources = report?.sources ?? [];

  /**
   * Why filing export is unavailable, or null when it is available.
   *
   * Mirrors the server's condition rather than guessing at it: export.service.ts refuses unless
   * `verified && signedOff`. Stating which of the two is missing matters — "not verified" is
   * something the drafter has to fix, "not signed off" is one click away.
   */
  const filingBlockedReason = unverified
    ? t.lex.filingNeedsReverify
    : !verified
      ? t.lex.filingNeedsVerified.replace(
          "{n}",
          report ? String(report.unsupported) : "?"
        )
      : !signedOff
        ? t.lex.filingNeedsSignOff
        : null;

  const updateClaim = (claimId: string, patch: Partial<LexArtifactClaim>) =>
    setDraft(
      (prev) =>
        prev?.map((c) => (c.claimId === claimId ? { ...c, ...patch } : c)) ??
        null
    );

  const removeClaim = (claim: LexArtifactClaim) => {
    // A cited claim says so before it goes: deleting it removes a reference from a court draft, and
    // the server refuses that unless it is acknowledged. The confirm IS the acknowledgement.
    const message = claim.citation
      ? t.lex.confirmRemoveCitedClaim
      : t.lex.confirmRemoveClaim;
    if (!window.confirm(message)) return;
    if (claim.citation) setDroppedCited((prev) => [...prev, claim.claimId]);
    setDraft(
      (prev) => prev?.filter((c) => c.claimId !== claim.claimId) ?? null
    );
  };

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

      {/* Verification banner.

          THREE states, not two. `unverified` — an edit that has not been re-checked — used to fall
          into the "failed" branch and report stale counts as though a judge had rejected something,
          which is both wrong and the opposite of actionable. */}
      <div
        className={`rounded-xl border p-3 text-sm flex items-center gap-2 ${
          verified
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-amber-50 border-amber-200 text-amber-800"
        }`}
      >
        {verified ? <ShieldCheck className="h-4 w-4" /> : null}
        <span>
          {unverified ? (
            t.lex.needsReverify
          ) : (
            <>
              {verified ? t.lex.verified : t.lex.verificationFailed}
              {report
                ? ` — ${report.supported}/${report.total} ${t.lex.claimsSupported}`
                : ""}
              {/* Stated, never folded into the count: these sentences assert no fact, and hiding
                  them would make the document's own voice invisible. */}
              {report?.notChecked
                ? ` · ${report.notChecked} ${t.lex.notCheckedCount}`
                : ""}
              {signedOff ? ` · ${t.lex.signedOff}` : ""}
            </>
          )}
        </span>
      </div>

      {verifying ? (
        <div className="rounded-xl border bg-card p-3 text-sm flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            {verifyTask?.step ??
              (verifyTask?.progressTotal
                ? `${verifyTask.progressDone}/${verifyTask.progressTotal}`
                : t.lex.reverifyQueued)}
          </span>
        </div>
      ) : null}

      {/* Actions.

          The filing export is GATED CLIENT-SIDE to match the server, which refuses it with a 409
          unless the version is both machine-verified and signed off (export.service.ts). It used to
          be offered unconditionally, so on the common case — any claim unsupported, so
          verificationStatus 'failed' — clicking it did nothing but log a 409. The server gate stays
          exactly as strict; what changes is that the UI no longer offers an action it knows will be
          refused, says in one sentence what is missing, and now offers the two actions that FIX it
          rather than only reporting the problem. */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button onClick={handleSave} disabled={busy}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {t.lex.saveChanges}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(null);
                  setDroppedCited([]);
                }}
                disabled={busy}
              >
                <Undo2 className="h-4 w-4 mr-2" />
                {t.lex.cancel}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setDraft(version.bodyJson?.claims ?? [])}
                disabled={busy || signedOff}
                title={signedOff ? t.lex.signedOffReadOnly : undefined}
              >
                <Pencil className="h-4 w-4 mr-2" />
                {t.lex.editClaims}
              </Button>
              <Button
                variant={filingBlockedReason ? "default" : "outline"}
                onClick={handleReverify}
                disabled={busy || verifying || signedOff}
                title={signedOff ? t.lex.signedOffReadOnly : undefined}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${verifying ? "animate-spin" : ""}`}
                />
                {t.lex.reverify}
              </Button>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleSignOff}
            disabled={busy || editing || !verified || signedOff}
            title={
              signedOff
                ? undefined
                : !verified
                  ? t.lex.signOffNeedsVerified
                  : undefined
            }
            className="gradient-terracotta text-white"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {signedOff ? t.lex.signedOff : t.lex.signOff}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport(true)}
            disabled={busy || editing || filingBlockedReason !== null}
            title={filingBlockedReason ?? undefined}
          >
            <Download className="h-4 w-4 mr-2" />
            {t.lex.exportForFiling}
          </Button>
          <Button
            // The action that IS available while a draft is being worked on, so the row does not
            // read as three dead buttons.
            variant="outline"
            onClick={() => handleExport(false)}
            disabled={busy || editing}
          >
            <Download className="h-4 w-4 mr-2" />
            {t.lex.exportDraft}
          </Button>
        </div>
        {filingBlockedReason && !editing ? (
          <p className="text-xs text-muted-foreground">{filingBlockedReason}</p>
        ) : null}
        {editing ? (
          <p className="text-xs text-muted-foreground">{t.lex.editingHint}</p>
        ) : null}
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
            {editing ? (
              <div className="space-y-2">
                <Textarea
                  value={c.text}
                  onChange={(e) =>
                    updateClaim(c.claimId, { text: e.target.value })
                  }
                  rows={3}
                  className="text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={c.kind ?? "assertion"}
                    onChange={(e) => {
                      const kind = e.target.value as LexClaimKind;
                      // Re-labelling a sentence as anything but an assertion also drops its
                      // citation, because that is what the label MEANS: verification is skipped
                      // only for a claim that cites nothing (isExemptFromVerification). Keeping the
                      // citation would leave the sentence being judged as a fact while the UI said
                      // it was a request — the action would silently not do what it says.
                      updateClaim(c.claimId, {
                        kind,
                        ...(kind === "assertion" ? {} : { citation: null })
                      });
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {kindLabel(t, k)}
                      </option>
                    ))}
                  </select>
                  {c.citation ? (
                    <button
                      onClick={() => updateClaim(c.claimId, { citation: null })}
                      className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
                    >
                      <X className="h-3 w-3" />
                      {t.lex.removeCitation}
                    </button>
                  ) : null}
                  <button
                    onClick={() => removeClaim(c)}
                    className="ml-auto text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    {t.lex.removeClaim}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm whitespace-pre-wrap">{c.text}</p>
                {/* Three renderings for three genuinely different states, and the version-level
                    `unverified` overrides all of them: after an edit no verdict on this page has
                    been re-established, so showing a green citation chip under a sentence nobody
                    has re-checked would be the one lie this screen must not tell. */}
                {unverified ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t.lex.claimPendingReverify}
                  </div>
                ) : c.status === "supported" && c.citation ? (
                  <div className="mt-2 space-y-1">
                    {/* The citation is a CONTROL: it opens the pièce at the cited page with the
                        quote beside it. A chip that only named a filename left the reader to go and
                        find the passage by hand, which for a filed document is the difference
                        between a reference and a claim about one. */}
                    <button
                      onClick={() =>
                        trace(
                          c.citation!.documentId,
                          c.citation!.pageFrom,
                          c.citation!.quote
                        )
                      }
                      className="text-xs px-2 py-0.5 rounded-full bg-muted hover:bg-muted/70 inline-flex items-center gap-1"
                      title={t.lex.openAtPage}
                    >
                      <FileSearch className="h-3 w-3" />
                      {c.citation.filename}
                      {c.citation.pageFrom ? `, p.${c.citation.pageFrom}` : ""}
                    </button>
                    {/* The quote, visible rather than on hover: it is what establishes the
                        sentence, and it is the thing a signing lawyer has to read. */}
                    {c.citation.quote ? (
                      <p className="text-xs text-muted-foreground italic">
                        « {c.citation.quote} »
                      </p>
                    ) : null}
                  </div>
                ) : c.status === "not_checked" ? (
                  <div className="mt-2">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                      title={t.lex.notCheckedHint}
                    >
                      {kindLabel(t, c.kind ?? "argument")}
                    </span>
                  </div>
                ) : (
                  /* Two different problems, and they were rendered identically. `unsupported` means
                     nothing usable was cited or the quote is not in the source — the sentence has no
                     evidence behind it. `contradicted` means the quote is real and simply does not
                     carry what the sentence asserts, which is usually one claim too many and is
                     fixed by editing the sentence. The judge's reason says which. */
                  <div className="mt-2 space-y-1">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        c.status === "contradicted"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {c.status === "contradicted"
                        ? t.lex.claimNotCarried
                        : t.lex.unsupportedClaim}
                    </span>
                    {c.reason ? (
                      <p className="text-xs text-muted-foreground">
                        {c.reason}
                      </p>
                    ) : null}
                    {/* The quote that FAILED, and where it comes from. This is what a 'contradicted'
                        claim is fixed against: the sentence has to be edited down to what this
                        passage actually establishes, which cannot be judged from the reason alone.
                        Traceable like any other reference — the page is the final arbiter. */}
                    {c.citation?.quote ? (
                      <>
                        <button
                          onClick={() =>
                            trace(
                              c.citation!.documentId,
                              c.citation!.pageFrom,
                              c.citation!.quote
                            )
                          }
                          className="text-xs px-2 py-0.5 rounded-full bg-muted hover:bg-muted/70 inline-flex items-center gap-1"
                          title={t.lex.openAtPage}
                        >
                          <FileSearch className="h-3 w-3" />
                          {c.citation.filename}
                          {c.citation.pageFrom
                            ? `, p.${c.citation.pageFrom}`
                            : ""}
                        </button>
                        <p className="text-xs text-muted-foreground italic">
                          « {c.citation.quote} »
                        </p>
                      </>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {tracing ? (
        <DocumentViewerDialog
          document={tracing.document}
          initialPage={tracing.pageFrom}
          highlight={tracing.quote}
          onClose={() => setTracing(null)}
        />
      ) : null}
    </div>
  );
}
