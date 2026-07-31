import { memo, useMemo, type ReactNode } from "react";
import type { LexCitationEvent } from "@packages/types";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { remarkCitationMarkers } from "@/lib/remark-citation-markers";
import { MarkdownBoundary } from "./MarkdownBoundary";

// Only these protocols may appear in a link the model produced. Everything else (javascript:,
// data:) is rendered as inert text.
const SAFE_PROTOCOL = /^(https?:|mailto:)/i;

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
  citations
}: {
  content: string;
  citations: LexCitationEvent[];
}) {
  // Marker → the source it points at, so a chip can name its document on hover.
  const byIndex = useMemo(() => {
    const map = new Map<number, LexCitationEvent>();
    for (const c of citations) if (c.index) map.set(c.index, c);
    return map;
  }, [citations]);

  // The TUPLE form is required: unified treats each entry as a PLUGIN and calls it with the
  // options to obtain a transformer. Passing `remarkCitationMarkers({...})` handed it an
  // already-built transformer, which unified then called with no arguments — so the transformer
  // received `tree === undefined` and threw, taking the whole conversation view down with it.
  const plugins = useMemo<PluggableList>(
    () => [remarkGfm, [remarkCitationMarkers, { maxIndex: citations.length }]],
    [citations.length]
  );

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
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
        return (
          <sup
            className="lex-cite"
            title={
              source
                ? `${source.filename ?? "source"}${source.pageFrom ? `, p.${source.pageFrom}` : ""}${source.quote ? `\n\n${source.quote}` : ""}`
                : undefined
            }
          >
            {children as ReactNode}
          </sup>
        );
      }
    }),
    [byIndex]
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
