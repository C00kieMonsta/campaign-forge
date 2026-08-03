import { memo, useMemo, type ReactNode } from "react";
import type { LexCitationEvent } from "@packages/types";
import ReactMarkdown, { type Components } from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { remarkCitationMarkers } from "@/lib/remark-citation-markers";
import { MarkdownBoundary } from "./MarkdownBoundary";

// Only these protocols may appear in a link the model produced. Everything else (javascript:,
// data:) is rendered as inert text.
const SAFE_PROTOCOL = /^(https?:|mailto:)/i;

/**
 * In-app destinations a message may link to.
 *
 * Deliberately a narrow allow-list of paths this app owns, not "any relative URL": message content
 * is model output, and `//evil.example` is a protocol-relative URL that a naive "starts with /"
 * check would send off-site. Only the artifact route qualifies today — it is what a finished
 * drafting run posts so the document is one click from the conversation it was launched in.
 */
const INTERNAL_PATH = /^\/lex\/artifacts\/[0-9a-f-]{36}$/i;

/**
 * Renders an assistant reply as Markdown.
 *
 * Safety: this is model output, so raw HTML is never parsed — react-markdown does not enable
 * `rehype-raw`, and it must stay that way. Images are deliberately dropped rather than fetched
 * (a remote <img> in a reply would leak a request to a third party from inside a legal case
 * file), and link protocols are allow-listed.
 */
export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  citations,
  onTrace
}: {
  content: string;
  citations: LexCitationEvent[];
  /**
   * Opens the cited passage in its document. Without it a marker is a dead end: the tooltip could
   * name the pièce and the page, and the reader still had to go and find it by hand.
   */
  onTrace?: (citation: LexCitationEvent) => void;
}) {
  // Marker → the source it points at, so a chip can name its document and open it.
  const byIndex = useMemo(() => {
    const map = new Map<number, LexCitationEvent>();
    for (const c of citations) if (c.index) map.set(c.index, c);
    return map;
  }, [citations]);

  // The TUPLE form is required: unified treats each entry as a PLUGIN and calls it with the
  // options to obtain a transformer. Passing `remarkCitationMarkers({...})` handed it an
  // already-built transformer, which unified then called with no arguments — so the transformer
  // received `tree === undefined` and threw, taking the whole conversation view down with it.
  //
  // The keys of `byIndex`, not a count: markers are positions in the source list of the call that
  // wrote the answer, so they are sparse ([249], [397]) and a ceiling of `citations.length` left
  // nearly all of them as plain digits. See remarkCitationMarkers.
  const markerKey = useMemo(
    () => [...byIndex.keys()].sort((a, b) => a - b).join(","),
    [byIndex]
  );
  const plugins = useMemo<PluggableList>(
    () => [
      remarkGfm,
      [
        remarkCitationMarkers,
        { indexes: markerKey ? markerKey.split(",").map(Number) : [] }
      ]
    ],
    [markerKey]
  );

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        // Internal first: routed, same tab, no `noopener` dance — it is this app.
        if (typeof href === "string" && INTERNAL_PATH.test(href)) {
          return <Link to={href}>{children}</Link>;
        }
        const safe = typeof href === "string" && SAFE_PROTOCOL.test(href);
        if (!safe) return <>{children}</>;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        );
      },
      // Dropped on purpose — see the safety note above.
      img: () => null,
      cite: ({ children, ...props }) => {
        const index = Number(
          (props as Record<string, unknown>)["data-cite"] ?? 0
        );
        const source = byIndex.get(index);
        // The marker carries WHAT it points at, not just a number. A bare [397] is unreadable in a
        // legal document — the reader cannot tell an exhibit reference from an article number — so
        // the chip shows the pièce and page it resolves to and opens it on click. The number stays,
        // because it is what ties the sentence to the reference list underneath.
        const label = source
          ? `${source.filename ?? "source"}${source.pageFrom ? `, p.${source.pageFrom}` : ""}`
          : null;
        const title = source
          ? `${label}${source.quote ? `\n\n« ${source.quote} »` : ""}`
          : undefined;
        if (!source || !onTrace) {
          return (
            <sup className="lex-cite" title={title}>
              {children as ReactNode}
            </sup>
          );
        }
        return (
          <sup className="lex-cite">
            <button
              type="button"
              onClick={() => onTrace(source)}
              title={title}
              aria-label={`${label} — ${index}`}
              className="lex-cite-button"
            >
              {children as ReactNode}
            </button>
          </sup>
        );
      }
    }),
    [byIndex, onTrace]
  );

  return (
    <div className="lex-markdown">
      <MarkdownBoundary content={content}>
        <ReactMarkdown remarkPlugins={plugins} components={components}>
          {content}
        </ReactMarkdown>
      </MarkdownBoundary>
    </div>
  );
});
