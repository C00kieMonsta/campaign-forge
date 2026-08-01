import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LexDocument,
  LexStoryPayload,
  LexWorkspace
} from "@packages/types";
import { Button } from "@packages/ui";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Info,
  Loader2,
  MessageSquare
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import CaseTimeline from "@/components/lex/CaseTimeline";
import DocumentViewerDialog from "@/components/lex/DocumentViewerDialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import {
  buildYearBands,
  findRecurringAmounts,
  formatAmount,
  groupAmountsByDocument,
  groupIdenticalAmounts,
  moneyByYear,
  summariseMoney
} from "@/lib/caseStory";
import { cn } from "@/lib/utils";

/**
 * The Récit: what a case file says, laid out in time.
 *
 * A PAGE, not a dialog. This replaced a modal listing one row per document — the same list as the page
 * behind it, in less space — which is why it could never show a timeline and a money panel at once.
 *
 * Everything here is DERIVED from stored text. The amounts are found by a deterministic pattern and
 * each one carries the sentence it came from; nothing is generated, so nothing can be invented. What
 * the page deliberately does NOT say is who paid or who received: the documents state sums, and
 * attributing them is reading the page — which is one click away on every row.
 */

/**
 * How many recurring sums lead the page.
 *
 * A DISPLAY limit, not a filter: the real corpus has 351 sums appearing in more than one document, and
 * a headline panel of 351 rows is the wall of figures this view replaced. The heading states the full
 * count and how many are shown, and the button reveals the rest — so the cap is visible rather than
 * silent, which is the difference between a summary and a half-truth.
 */
const RECURRING_PREVIEW = 12;

/**
 * Act dates shown before the list is expanded. A DISPLAY limit, stated in the heading and lifted by a
 * button: the real corpus yields 625 distinct dates, and all of them at once is the wall this view
 * replaced.
 */
const ACTS_PREVIEW = 20;

export default function LexWorkspaceStory() {
  const { id = "" } = useParams();
  const { t } = useLanguage();
  const s = t.lex.story;
  const { toast } = useToast();
  const navigate = useNavigate();

  const [workspace, setWorkspace] = useState<LexWorkspace | null>(null);
  const [docs, setDocs] = useState<LexDocument[]>([]);
  const [story, setStory] = useState<LexStoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerDoc, setViewerDoc] = useState<LexDocument | null>(null);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  /**
   * Which sections are open. Everything starts COLLAPSED: this file yields 2788 amounts, and showing
   * them expanded is the wall of figures this view exists to replace. A closed row still carries its
   * headline — the sum, how many documents state it — so the list is scannable without opening
   * anything, and reading is a deliberate act.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [showAllRecurring, setShowAllRecurring] = useState(false);
  const [showAllActs, setShowAllActs] = useState(false);
  /**
   * Two readings of the same chronology. "Weight" first, because on a file of this age the useful
   * question is which dates the parties keep coming back to; chronological is for reading the story
   * end to end.
   */
  const [actsOrder, setActsOrder] = useState<"weight" | "chronological">(
    "weight"
  );
  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ workspace: ws }, { items }, payload] = await Promise.all([
        api.lex.workspaces.get(id),
        api.lex.workspaces.timeline(id),
        api.lex.workspaces.story(id)
      ]);
      setWorkspace(ws);
      setDocs(items);
      setStory(payload);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => {
    const map = new Map<string, LexDocument>();
    for (const doc of docs) map.set(doc.id, doc);
    return map;
  }, [docs]);

  // Only the documents that are part of the file: the chore shelves (never-uploaded, failed) and the
  // archive are not events in the story.
  const storyDocs = useMemo(
    () =>
      docs.filter(
        (doc) =>
          doc.lifecycleState === "active" &&
          doc.parseStatus !== "awaiting_upload" &&
          doc.parseStatus !== "failed"
      ),
    [docs]
  );

  const bands = useMemo(
    () =>
      buildYearBands(
        storyDocs.map((doc) => ({ id: doc.id, date: doc.timelineDate ?? "" }))
      ),
    [storyDocs]
  );

  /** documentId -> its four-digit year, or null. Feeds the money strip and the year filter. */
  const yearOfDocument = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const doc of storyDocs)
      map.set(doc.id, /^(\d{4})/.exec(doc.timelineDate ?? "")?.[1] ?? null);
    return map;
  }, [storyDocs]);

  const amounts = story?.amounts ?? [];
  const money = useMemo(() => summariseMoney(amounts), [amounts]);
  const amountsByDoc = useMemo(
    () => groupAmountsByDocument(amounts),
    [amounts]
  );
  const recurring = useMemo(() => findRecurringAmounts(amounts), [amounts]);
  /** Distinct sums, which is the only honest count — 2788 mentions are not 2788 figures. */
  const distinctSumCount = useMemo(
    () => groupIdenticalAmounts(amounts).length,
    [amounts]
  );
  const actDates = useMemo(() => {
    const all = story?.actDates ?? [];
    if (actsOrder === "weight") return all; // already ranked by the server
    return [...all].sort((a, b) =>
      a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0
    );
  }, [story, actsOrder]);
  const visibleActs = useMemo(
    () => (showAllActs ? actDates : actDates.slice(0, ACTS_PREVIEW)),
    [actDates, showAllActs]
  );
  const yearMoney = useMemo(
    () => moneyByYear(amounts, yearOfDocument),
    [amounts, yearOfDocument]
  );

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-16 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <button
        onClick={() => navigate(`/lex/workspaces/${id}`)}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" />
        {t.lex.back}
      </button>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-serif font-bold truncate">
            {workspace?.name ?? t.lex.title}
          </h1>
          <p className="text-sm text-muted-foreground">{s.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => navigate(`/lex/workspaces/${id}`)}
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            {t.lex.chat}
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate(`/lex/workspaces/${id}/documents`)}
          >
            <FileText className="h-4 w-4 mr-2" />
            {t.lex.allDocuments}
          </Button>
        </div>
      </div>

      {/* ── 1. Chronology, as year bands ─────────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-serif font-semibold">{s.timelineTitle}</h2>
          <p className="text-xs text-muted-foreground">
            {bands.bands.length > 0
              ? s.timelineSpan
                  .replace("{from}", bands.bands[0].year)
                  .replace("{to}", bands.bands[bands.bands.length - 1].year)
                  .replace(
                    "{count}",
                    String(bands.bands.reduce((n, b) => n + b.items.length, 0))
                  )
              : s.timelineEmpty}
          </p>
        </div>

        <CaseTimeline
          bands={bands}
          money={yearMoney}
          documentsById={byId}
          selectedYear={selectedYear}
          onSelectYear={setSelectedYear}
          onOpenDocument={setViewerDoc}
        />

        <p className="text-[11px] text-muted-foreground">{s.timelineLegend}</p>

        {/* Undated documents are listed, never dropped: a piece with no extracted date is still a
            piece of the file, and silently omitting it is how one disappears. */}
        {bands.undated.length > 0 ? (
          <div className="rounded-lg border border-dashed p-2.5 space-y-1">
            <p className="text-xs text-muted-foreground">
              {s.undatedCount.replace("{count}", String(bands.undated.length))}
            </p>
            <div className="flex flex-wrap gap-1">
              {bands.undated.map((item) => {
                const doc = byId.get(item.id);
                if (!doc) return null;
                return (
                  <button
                    key={item.id}
                    onClick={() => setViewerDoc(doc)}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:text-foreground max-w-[18rem] truncate"
                    title={doc.filename}
                  >
                    {doc.filename}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {/* ── 2. The acts, as the documents date them ──────────────────────────────────── */}
      {actDates.length > 0 ? (
        <section className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="font-serif font-semibold">{s.actsTitle}</h2>
            <p className="text-xs text-muted-foreground">
              {s.actsCount.replace("{count}", String(actDates.length))}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">{s.actsHint}</p>

          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setActsOrder("weight")}
              aria-pressed={actsOrder === "weight"}
              className={cn(
                "px-2 py-1 rounded-md",
                actsOrder === "weight"
                  ? "bg-secondary text-secondary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.actsByWeight}
            </button>
            <button
              onClick={() => setActsOrder("chronological")}
              aria-pressed={actsOrder === "chronological"}
              className={cn(
                "px-2 py-1 rounded-md",
                actsOrder === "chronological"
                  ? "bg-secondary text-secondary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.actsByDate}
            </button>
          </div>

          <ul className="space-y-1">
            {visibleActs.map((act) => {
              const key = `act:${act.iso}`;
              const open = expanded.has(key);
              return (
                <li key={key} className="rounded-lg border">
                  <button
                    onClick={() => toggle(key)}
                    className="w-full flex items-baseline gap-2 px-3 py-2 text-left hover:bg-muted/40 min-w-0"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 mt-0.5 transition-transform",
                        open && "rotate-90"
                      )}
                    />
                    <span className="text-sm font-medium tabular-nums shrink-0">
                      {act.iso}
                    </span>
                    {/* An inferred century is marked. The document wrote "98", not "1998". */}
                    {act.yearInferred ? (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0"
                        title={s.yearInferredHint}
                      >
                        {s.yearInferredBadge}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      {act.samples[0]?.excerpt ?? ""}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {s.inDocuments.replace(
                        "{count}",
                        String(act.documentCount)
                      )}
                    </span>
                  </button>
                  {open ? (
                    <div className="px-3 pb-3 space-y-2 border-t">
                      {act.samples.map((sample) => {
                        const doc = byId.get(sample.documentId);
                        return (
                          <div key={sample.documentId} className="text-xs pt-2">
                            <button
                              onClick={() => doc && setViewerDoc(doc)}
                              className="font-medium hover:underline text-left flex items-baseline gap-2 min-w-0 w-full"
                            >
                              <span className="text-muted-foreground tabular-nums shrink-0">
                                {doc?.timelineDate ?? t.lex.noDate}
                              </span>
                              <span className="truncate">
                                {doc?.filename ?? sample.documentId}
                              </span>
                              {sample.pageFrom ? (
                                <span className="text-muted-foreground shrink-0">
                                  {`p.${sample.pageFrom}`}
                                </span>
                              ) : null}
                            </button>
                            <p className="text-muted-foreground italic mt-0.5">
                              …{sample.excerpt}…
                            </p>
                          </div>
                        );
                      })}
                      {act.documentCount > act.samples.length ? (
                        <p className="text-[11px] text-muted-foreground pt-1">
                          {s.actsMoreDocuments.replace(
                            "{count}",
                            String(act.documentCount - act.samples.length)
                          )}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {actDates.length > ACTS_PREVIEW ? (
            <button
              onClick={() => setShowAllActs((prev) => !prev)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {showAllActs
                ? s.actsLess
                : s.actsMore.replace(
                    "{count}",
                    String(actDates.length - ACTS_PREVIEW)
                  )}
            </button>
          ) : null}
        </section>
      ) : null}

      {/* ── 2. What the file is arguing about, in figures ─────────────────────────────── */}
      <section className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-serif font-semibold">{s.moneyTitle}</h2>
          <p className="text-xs text-muted-foreground">
            {s.moneyCount
              .replace("{distinct}", String(distinctSumCount))
              .replace("{amounts}", String(money.amountCount))
              .replace("{documents}", String(money.documentCount))}
          </p>
        </div>

        {/* Deliberately NOT a total. Adding up every figure a case file mentions produces a number
            that means nothing: the same sale is counted once per mention across eighteen filings, and
            prices, balances, fees and running totals are summed together. On this file that arithmetic
            produced 317 million euros for an estate whose largest single transaction is 45,5 million
            Belgian francs. A number that wrong is worse than no number. What follows are the DISTINCT
            sums, ranked by how many separate documents argue them. */}
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 rounded-lg border border-dashed p-2.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{s.moneyDisclaimer}</span>
        </p>

        {story?.truncated ? (
          <p className="text-xs text-destructive">
            {s.truncated.replace("{limit}", String(story.chunkLimit))}
          </p>
        ) : null}

        {money.byCurrency.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {s.currenciesPresent.replace(
              "{list}",
              money.byCurrency
                .map((c) => `${c.currency} (${c.count})`)
                .join(" · ")
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{s.moneyEmpty}</p>
        )}
      </section>

      {/* ── 3. What recurs across documents: the one thread available with no inference ──── */}
      {recurring.length > 0 ? (
        <section className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="font-serif font-semibold">{s.recurringTitle}</h2>
            <p className="text-xs text-muted-foreground">
              {recurring.length > RECURRING_PREVIEW && !showAllRecurring
                ? s.recurringShown
                    .replace("{shown}", String(RECURRING_PREVIEW))
                    .replace("{total}", String(recurring.length))
                : s.recurringAll.replace("{total}", String(recurring.length))}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">{s.recurringHint}</p>
          <ul className="space-y-1.5">
            {(showAllRecurring
              ? recurring
              : recurring.slice(0, RECURRING_PREVIEW)
            ).map((group) => {
              const key = `r:${group.currency}:${group.value}`;
              const open = expanded.has(key);
              return (
                <li key={key} className="rounded-lg border">
                  <button
                    onClick={() => toggle(key)}
                    className="w-full flex items-baseline gap-2 px-3 py-2 text-left hover:bg-muted/40"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 mt-0.5 transition-transform",
                        open && "rotate-90"
                      )}
                    />
                    <span className="text-sm font-medium tabular-nums">
                      {formatAmount(group.value, group.currency)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.inDocuments.replace(
                        "{count}",
                        String(group.documentIds.length)
                      )}
                    </span>
                  </button>
                  {open ? (
                    <div className="px-3 pb-3 pt-0 space-y-2 border-t">
                      {group.samples.map((sample) => {
                        const doc = byId.get(sample.documentId);
                        return (
                          <div key={sample.documentId} className="text-xs pt-2">
                            <button
                              onClick={() => doc && setViewerDoc(doc)}
                              className="font-medium hover:underline text-left flex items-baseline gap-2 min-w-0 w-full"
                            >
                              <span className="text-muted-foreground tabular-nums shrink-0">
                                {doc?.timelineDate ?? t.lex.noDate}
                              </span>
                              <span className="truncate">
                                {doc?.filename ?? sample.documentId}
                              </span>
                              {sample.pageFrom ? (
                                <span className="text-muted-foreground shrink-0">
                                  {`p.${sample.pageFrom}`}
                                </span>
                              ) : null}
                            </button>
                            <p className="text-muted-foreground italic mt-0.5">
                              …{sample.excerpt}…
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {recurring.length > RECURRING_PREVIEW ? (
            <button
              onClick={() => setShowAllRecurring((prev) => !prev)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {showAllRecurring
                ? s.recurringLess
                : s.recurringMore.replace(
                    "{count}",
                    String(recurring.length - RECURRING_PREVIEW)
                  )}
            </button>
          ) : null}
        </section>
      ) : null}

      {/* ── 4. Every amount, by document, collapsed ───────────────────────────────────── */}
      {amountsByDoc.size > 0 ? (
        <section className="rounded-xl border bg-card p-4 space-y-3">
          <h2 className="font-serif font-semibold">{s.excerptsTitle}</h2>
          <p className="text-[11px] text-muted-foreground">{s.excerptsHint}</p>
          <ul className="space-y-1">
            {[...amountsByDoc.entries()]
              // Clicking a year on the chronology narrows every panel below it, so the timeline is a
              // control rather than a picture.
              .filter(
                ([docId]) =>
                  !selectedYear || yearOfDocument.get(docId) === selectedYear
              )
              .map(([docId, hits]) => {
                const doc = byId.get(docId);
                if (!doc) return null;
                const groups = groupIdenticalAmounts(hits);
                const open = expanded.has(docId);
                const biggest = groups[0];
                return (
                  <li key={docId} className="rounded-lg border">
                    <button
                      onClick={() => toggle(docId)}
                      className="w-full flex items-baseline gap-2 px-3 py-2 text-left hover:bg-muted/40 min-w-0"
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 mt-0.5 transition-transform",
                          open && "rotate-90"
                        )}
                      />
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {doc.timelineDate ?? t.lex.noDate}
                      </span>
                      <span className="text-sm truncate flex-1">
                        {doc.filename}
                      </span>
                      {/* Collapsed, a document still says what it is about: how many distinct sums
                          it states and the largest of them. */}
                      <span className="text-xs text-muted-foreground shrink-0">
                        {s.distinctSums.replace(
                          "{count}",
                          String(groups.length)
                        )}
                        {biggest
                          ? ` · ${formatAmount(biggest.value, biggest.currency)}`
                          : ""}
                      </span>
                    </button>
                    {open ? (
                      <ul className="px-3 pb-3 space-y-2 border-t">
                        {groups.map((group) => {
                          const gk = `${docId}:${group.currency}:${group.value}`;
                          const gOpen = expanded.has(gk);
                          return (
                            <li key={gk} className="text-xs pt-2">
                              <button
                                onClick={() => toggle(gk)}
                                className="flex items-baseline gap-2 text-left w-full"
                              >
                                <span className="font-medium tabular-nums">
                                  {formatAmount(group.value, group.currency)}
                                </span>
                                <span className="text-muted-foreground">
                                  {group.pages.length
                                    ? `p.${group.pages.join(", p.")}`
                                    : ""}
                                  {group.occurrences.length > 1
                                    ? ` · ${s.statedTimes.replace(
                                        "{count}",
                                        String(group.occurrences.length)
                                      )}`
                                    : ""}
                                </span>
                              </button>
                              {gOpen ? (
                                <div className="mt-1 space-y-1 pl-3 border-l">
                                  {group.occurrences.map((hit) => (
                                    <button
                                      key={`${hit.chunkId}-${hit.charStart}`}
                                      onClick={() => setViewerDoc(doc)}
                                      className="block text-left text-muted-foreground italic hover:text-foreground"
                                    >
                                      {hit.pageFrom
                                        ? `p.${hit.pageFrom} — `
                                        : ""}
                                      …{hit.excerpt}…
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
          </ul>
          {selectedYear ? (
            <button
              onClick={() => setSelectedYear(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {s.clearYear.replace("{year}", selectedYear)}
            </button>
          ) : null}
        </section>
      ) : null}

      {viewerDoc ? (
        <DocumentViewerDialog
          document={viewerDoc}
          onClose={() => setViewerDoc(null)}
        />
      ) : null}
    </div>
  );
}
