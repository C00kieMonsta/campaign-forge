import type { LexDeathMention, LexDocument } from "@packages/types";
import { useLanguage } from "@/contexts/LanguageContext";
import PieceCite from "./PieceCite";

/**
 * The one date that decides which law the whole file runs under, quoted, at the top of the page.
 *
 * WHY IT LEADS. Belgian succession law turns on the date of death: art. 66 of the loi du 31 juillet
 * 2017 applies the reform to successions opened FROM 1 September 2018, including as regards donations
 * made before. Which side of that line a file falls on decides the réserve fraction, whether donations
 * are indexed, whether réduction runs in nature or in value, and which limitation period applies. A
 * practitioner reading a twenty-year file reads that date first, so the page shows it first.
 *
 * WHAT IT REFUSES TO SAY, and this is deliberate to the word. It reports that N pieces write this
 * sentence, and it states a fixed statutory date. It does NOT say whose succession opened, that a
 * succession opened at all, which régime governs, or what any horizon is — the first is a role this
 * application never assigns (C3), the rest are legal conclusions no pattern can reach.
 *
 * A CORROBORATION FLOOR OF TWO. The server returns single-document mentions so the floor is a stated
 * UI choice rather than a silent server filter; measured on the real file, two documents leaves the
 * true death date and drops a lone stray. Whatever the floor hides is counted below.
 *
 * ALWAYS RENDERED, EVEN EMPTY. A panel that disappears when it finds nothing reads as a claim never
 * tested. When no document writes the trigger, this says so in one sentence.
 */

/** Fixed statutory date. Not a computation — a constant the law sets, compared against. */
const REFORM_DATE = "2018-09-01";

/** Below this a mention is one document's phrasing, not a fact the file agrees on. */
const MIN_DOCUMENTS = 2;
/** Dates listed before the rest become a count. */
const MAX_DATES = 3;
/** Quoted passages per date. */
const MAX_SAMPLES = 3;

export default function CaseRepere({
  mentions,
  documentsById,
  onOpenDocument
}: {
  mentions: readonly LexDeathMention[];
  documentsById: ReadonlyMap<string, LexDocument>;
  onOpenDocument: (doc: LexDocument, page?: number | null) => void;
}) {
  const { t } = useLanguage();
  const s = t.lex.story;

  const corroborated = mentions.filter((m) => m.documentCount >= MIN_DOCUMENTS);
  const shown = corroborated.slice(0, MAX_DATES);
  const hidden = mentions.length - shown.length;

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <h2 className="font-serif font-semibold">{s.repere.title}</h2>
      <p className="text-[11px] text-muted-foreground">{s.repere.how}</p>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{s.repere.empty}</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((mention) => (
            <li key={mention.iso} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-medium tabular-nums">
                  {mention.iso}
                </span>
                {mention.yearInferred ? (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700"
                    title={s.yearInferredHint}
                  >
                    {s.yearInferredBadge}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {s.inDocuments.replace(
                    "{count}",
                    String(mention.documentCount)
                  )}
                </span>
              </div>

              <p className="text-sm">
                {mention.iso < REFORM_DATE ? s.repere.before : s.repere.after}
              </p>

              <ul className="space-y-1.5">
                {mention.samples.slice(0, MAX_SAMPLES).map((sample) => (
                  <li key={`${sample.documentId}:${sample.chunkId}`}>
                    <PieceCite
                      document={documentsById.get(sample.documentId)}
                      documentId={sample.documentId}
                      page={sample.pageFrom}
                      onOpen={onOpenDocument}
                    />
                    <p className="text-xs text-muted-foreground italic mt-0.5">
                      …{sample.excerpt}…
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {s.repere.more.replace("{count}", String(hidden))}
        </p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">{s.repere.limits}</p>
    </section>
  );
}
