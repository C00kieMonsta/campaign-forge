import type { LexDocument } from "@packages/types";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

/**
 * The pin cite: which piece said it, when it was filed, and on which page — as a control that opens
 * the document AT that page.
 *
 * There is one of these under every fact on the Récit page, and that is the whole discipline of the
 * view: nothing here is generated, so every statement travels with the literal passage it came from
 * and a way to check it. The professional convention is the same — CaseMap stores a fact's source as
 * "ArndtDepo, Pg. 112, Line 14", not as a document name — and under art. 744 C. jud. a Belgian
 * conclusion must give, for each allegation, the piece invoked and its number.
 *
 * Rendered as one component so a cite cannot drift between the three panels that show one.
 */
export default function PieceCite({
  document: doc,
  documentId,
  page,
  onOpen,
  className
}: {
  /** The document, when it is in the loaded list. */
  document?: LexDocument;
  /** Fallback when it is not — the id is still shown rather than the row silently losing its source. */
  documentId: string;
  page?: number | null;
  onOpen: (doc: LexDocument, page?: number | null) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const s = t.lex.story;

  const label =
    page != null
      ? s.registre.openAtPage.replace("{page}", String(page))
      : s.registre.openPiece;

  return (
    <button
      type="button"
      disabled={!doc}
      aria-label={`${doc?.filename ?? documentId} — ${label}`}
      title={label}
      onClick={() => doc && onOpen(doc, page)}
      className={cn(
        "flex items-baseline gap-2 min-w-0 w-full text-left text-xs",
        doc
          ? "hover:underline focus-visible:underline"
          : "cursor-default opacity-70",
        className
      )}
    >
      <span className="text-muted-foreground tabular-nums shrink-0">
        {doc?.timelineDate ?? t.lex.noDate}
      </span>
      <span className="truncate font-medium">
        {doc?.filename ?? documentId}
      </span>
      {page != null ? (
        <span className="text-muted-foreground shrink-0 tabular-nums">{`p.${page}`}</span>
      ) : null}
    </button>
  );
}
