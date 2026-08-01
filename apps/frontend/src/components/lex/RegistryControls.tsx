import {
  LEGAL_TERM_GROUPS,
  legalTermsInGroup,
  type LegalTermGroup
} from "@packages/types";
import { useLanguage } from "@/contexts/LanguageContext";
import type { CorroborationCut, FactOrder, TermCount } from "@/lib/caseStory";
import { cn } from "@/lib/utils";

/**
 * The control bar: how much of the file the registry shows, and what that choice hides.
 *
 * THE CUT ALWAYS STATES ITS COST. Every rung of the corroboration ladder drops facts, so the caption
 * under it prints how many — "608 dates relevées ; 553 énoncées par moins de 5 pièces sont masquées
 * ici". C8 in one line: a display cap that does not say what it hid is a summary pretending to be the
 * file.
 *
 * THE CHIPS ARE WORDS, NOT QUALIFICATIONS. Each chip is a term found within 200 characters of the
 * date. "rapportable" as a chip means a document writes the word near that date — never that the
 * liberality is rapportable, which art. 4.83 § 1 C. civ. requires to be established "de manière
 * certaine" by reading the act. Hence the heading "termes relevés dans le texte" and the caption
 * saying so again.
 *
 * A CHIP AT ZERO IS RENDERED, DISABLED, WITH ITS COUNT. Two reasons. It can never empty the table by
 * being clicked. And the thin entries are as much of a finding as the fat ones: on the real file
 * "quotité disponible" reaches no fact and the whole art. 918 trigger set is absent, which tells a
 * practitioner where the file is argumentatively silent. A chip that simply vanished would say
 * nothing at all.
 */

/** Chips are counted within the CUT, not within the full filter, so toggling one never moves the
 *  others. A count that changed as you clicked would be unreadable as a measurement of the file. */
export default function RegistryControls({
  cuts,
  threshold,
  defaultThreshold,
  totalFacts,
  order,
  termCounts,
  selectedTerms,
  factsWithoutTerms,
  requireAmount,
  requireRef,
  amountFactCount,
  refFactCount,
  onThreshold,
  onOrder,
  onToggleTerm,
  onClearTerms,
  onRequireAmount,
  onRequireRef
}: {
  cuts: readonly CorroborationCut[];
  threshold: number;
  /** The rung the page opened on, printed when the ladder had to climb past the first. */
  defaultThreshold: number;
  totalFacts: number;
  order: FactOrder;
  /** One entry per term id, in table order, counted within the current cut. */
  termCounts: readonly TermCount[];
  selectedTerms: ReadonlySet<string>;
  factsWithoutTerms: number;
  requireAmount: boolean;
  requireRef: boolean;
  amountFactCount: number;
  refFactCount: number;
  onThreshold: (value: number) => void;
  onOrder: (value: FactOrder) => void;
  onToggleTerm: (id: string) => void;
  onClearTerms: () => void;
  onRequireAmount: (value: boolean) => void;
  onRequireRef: (value: boolean) => void;
}) {
  const { t } = useLanguage();
  const s = t.lex.story;

  const counts = new Map(termCounts.map((c) => [c.id, c.count]));
  const termLabel = (id: string) =>
    (s.terms as Record<string, string>)[id] ?? id;
  const groupLabel = (group: LegalTermGroup) =>
    (s.termGroups as Record<string, string>)[group] ?? group;

  const active = cuts.find((cut) => cut.threshold === threshold);
  /** The lowest rung offered; the ladder having climbed past it is worth saying out loud. */
  const lowestOffered = cuts.reduce(
    (min, cut) => Math.min(min, cut.threshold),
    Number.POSITIVE_INFINITY
  );

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <h2 className="font-serif font-semibold">{s.controls.title}</h2>
      <p className="text-[11px] text-muted-foreground">{s.controls.how}</p>

      {/* ── a. Corroboration ─────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <div
          className="flex items-center gap-2 flex-wrap text-xs"
          role="group"
          aria-label={s.controls.corroboration}
        >
          <span className="text-muted-foreground">
            {s.controls.corroboration}
          </span>
          {cuts.map((cut) => (
            <button
              key={cut.threshold}
              type="button"
              aria-pressed={cut.threshold === threshold}
              onClick={() => onThreshold(cut.threshold)}
              className={cn(
                "px-2 py-1 rounded-md tabular-nums",
                cut.threshold === threshold
                  ? "bg-secondary text-secondary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {cut.threshold <= lowestOffered
                ? s.controls.cutAll
                : s.controls.cut.replace("{count}", String(cut.threshold))}
              <span className="ml-1 opacity-70">{`· ${cut.count}`}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {active && active.hidden > 0
            ? s.controls.hidden
                .replace("{total}", String(totalFacts))
                .replace("{hidden}", String(active.hidden))
                .replace("{threshold}", String(threshold))
            : s.controls.hiddenNone.replace("{total}", String(totalFacts))}
          {defaultThreshold > lowestOffered
            ? ` ${s.controls.defaultThreshold}`
            : ""}
        </p>
      </div>

      {/* ── b. Order. Chronological leads: a ledger reads in time. ────────────────────── */}
      <div
        className="flex items-center gap-2 text-xs"
        role="group"
        aria-label={s.controls.order}
      >
        <span className="text-muted-foreground">{s.controls.order}</span>
        <button
          type="button"
          aria-pressed={order === "chronological"}
          onClick={() => onOrder("chronological")}
          className={cn(
            "px-2 py-1 rounded-md",
            order === "chronological"
              ? "bg-secondary text-secondary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {s.actsByDate}
        </button>
        <button
          type="button"
          aria-pressed={order === "weight"}
          onClick={() => onOrder("weight")}
          className={cn(
            "px-2 py-1 rounded-md",
            order === "weight"
              ? "bg-secondary text-secondary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {s.actsByWeight}
        </button>
      </div>

      {/* ── c. Terms found in the text ────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">
            {s.controls.terms}
          </span>
          {selectedTerms.size > 0 ? (
            <button
              type="button"
              onClick={onClearTerms}
              className="text-[11px] text-muted-foreground hover:text-foreground underline"
            >
              {s.controls.clearTerms}
            </button>
          ) : null}
        </div>

        {LEGAL_TERM_GROUPS.map((group) => (
          <div key={group} className="flex items-start gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground w-full sm:w-44 shrink-0 pt-1">
              {groupLabel(group)}
            </span>
            <div
              className="flex flex-wrap gap-1 flex-1"
              role="group"
              aria-label={`${s.controls.terms} — ${groupLabel(group)}`}
            >
              {legalTermsInGroup(group).map((term) => {
                const count = counts.get(term.id) ?? 0;
                const on = selectedTerms.has(term.id);
                return (
                  <button
                    key={term.id}
                    type="button"
                    disabled={count === 0}
                    aria-pressed={on}
                    onClick={() => onToggleTerm(term.id)}
                    className={cn(
                      "text-[11px] px-2 py-0.5 rounded-full border",
                      count === 0
                        ? "opacity-45 cursor-not-allowed text-muted-foreground"
                        : on
                          ? "bg-secondary text-secondary-foreground font-medium border-secondary"
                          : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {termLabel(term.id)}
                    <span className="ml-1 tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <p className="text-[11px] text-muted-foreground">
          {s.controls.termsHow
            .replace("{count}", String(factsWithoutTerms))
            .replace("{total}", String(totalFacts))}
          {selectedTerms.size > 1
            ? ` ${s.controls.termsSelected.replace(
                "{count}",
                String(selectedTerms.size)
              )}`
            : ""}
        </p>
      </div>

      {/* ── d. Two more narrowings ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 flex-wrap text-xs">
        <span className="text-muted-foreground">{s.controls.also}</span>
        <label
          className={cn(
            "inline-flex items-center gap-1.5",
            amountFactCount === 0 && "opacity-45"
          )}
        >
          <input
            type="checkbox"
            checked={requireAmount}
            disabled={amountFactCount === 0}
            onChange={(e) => onRequireAmount(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span>{s.controls.withAmount}</span>
          <span className="tabular-nums text-muted-foreground">{`(${amountFactCount})`}</span>
        </label>
        <label
          className={cn(
            "inline-flex items-center gap-1.5",
            refFactCount === 0 && "opacity-45"
          )}
        >
          <input
            type="checkbox"
            checked={requireRef}
            disabled={refFactCount === 0}
            onChange={(e) => onRequireRef(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span>{s.controls.withRef}</span>
          <span className="tabular-nums text-muted-foreground">{`(${refFactCount})`}</span>
        </label>
      </div>
    </section>
  );
}
