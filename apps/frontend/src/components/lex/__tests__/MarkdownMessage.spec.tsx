import type { LexCitationEvent } from "@packages/types";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownMessage } from "../MarkdownMessage";

// This renders through the REAL react-markdown/unified pipeline. That matters: the bug that took
// the conversation view down was in how the citation plugin was handed to unified, which is
// invisible when the plugin is tested on its own. Rendering to static markup avoids needing a
// testing library — the assertions are about emitted HTML anyway.

const source = (index: number, over: Partial<LexCitationEvent> = {}) =>
  ({
    index,
    filename: `piece-${index}.pdf`,
    pageFrom: index,
    quote: `extrait ${index}`,
    ...over
  }) as LexCitationEvent;

function render(
  content: string,
  citations: LexCitationEvent[] = [],
  onTrace?: (c: LexCitationEvent) => void
) {
  return renderToStaticMarkup(
    <MarkdownMessage
      content={content}
      citations={citations}
      onTrace={onTrace}
    />
  );
}

describe("MarkdownMessage", () => {
  it("renders markdown structure rather than literal syntax", () => {
    const html = render("## Titre\n\n- premier\n- second\n\n**gras**");
    expect(html).toContain("<h2>Titre</h2>");
    expect(html).toContain("<li>premier</li>");
    expect(html).toContain("<strong>gras</strong>");
    expect(html).not.toContain("## Titre");
  });

  it("renders GFM tables, which the assistant uses for date/party summaries", () => {
    const html = render("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  // The regression. Pre-invoking the plugin made unified call the transformer with no tree; it
  // threw, the boundary caught it, and the reply degraded to plain text. So the real assertion is
  // that citation chips actually appear.
  it("turns citation markers into chips titled with their source", () => {
    const html = render("La créance est établie [1].", [source(1)]);
    expect(html).toContain('class="lex-cite"');
    expect(html).toContain("piece-1.pdf, p.1");
    expect(html).toContain("extrait 1");
  });

  it("does not fall back to the plain-text boundary on a normal reply", () => {
    const html = render("Analyse [1] et [2].", [source(1), source(2)]);
    // The boundary's fallback is a single whitespace-pre-wrap div with no markup inside.
    expect(html).not.toContain("whitespace-pre-wrap");
    expect(html.match(/class="lex-cite"/g)).toHaveLength(2);
  });

  it("leaves a bracketed number that is not a source as plain text", () => {
    const html = render("Voir art. [9] et la pièce [1].", [source(1)]);
    expect(html.match(/class="lex-cite"/g)).toHaveLength(1);
    expect(html).toContain("[9]");
  });

  it("renders no chips when the reply cites nothing", () => {
    const html = render("Aucune source ici [1].", []);
    expect(html).not.toContain("lex-cite");
    expect(html).toContain("[1]");
  });

  /**
   * SPARSE markers — the bug that made an assessment's references untraceable.
   *
   * Markers are positions in the source list of the call that wrote the answer, not 1..N. An adverse
   * read over a large case file cites [249] and [397] while carrying a handful of citations, and the
   * plugin used to be bounded by `citations.length` — so every one of those markers rendered as bare
   * digits, and a lawyer reading a filed document had references pointing at nothing.
   */
  it("chips markers numbered far above the citation count", () => {
    const html = render("Les attestations [249] et le refus [410].", [
      source(249),
      source(410)
    ]);
    expect(html.match(/class="lex-cite"/g)).toHaveLength(2);
    expect(html).toContain("piece-249.pdf, p.249");
  });

  // A reference must be FOLLOWABLE, not merely labelled: with a handler the chip is a button that
  // opens the pièce at the cited page. Hovering to read a filename is not tracing a citation.
  it("renders a resolvable marker as a button when it can be traced", () => {
    const html = render("Établie [1].", [source(1)], () => undefined);
    expect(html).toContain("lex-cite-button");
    expect(html).toContain("<button");
  });

  it("renders a plain chip when there is nowhere to trace to", () => {
    const html = render("Établie [1].", [source(1)]);
    expect(html).toContain('class="lex-cite"');
    expect(html).not.toContain("<button");
  });

  // Safety invariants — this is model output.
  it("never parses raw HTML in a reply", () => {
    const html = render(
      'Texte <script>alert(1)</script> et <img src="https://evil.test/x.png">'
    );
    // Escaped, so it renders as inert text: no live element is created. The URL still appears in
    // the markup — as `&quot;https://evil.test...` inside a text node, which fetches nothing.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops images so a reply cannot beacon out of a case file", () => {
    const html = render("![legende](https://evil.test/pixel.png)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.test");
  });

  it("renders an unsafe link protocol as inert text", () => {
    const html = render("[clic](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
    expect(html).toContain("clic");
  });

  it("keeps http(s) links, opened safely", () => {
    const html = render("[juridat](https://juportal.be/x)");
    expect(html).toContain('href="https://juportal.be/x"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it("survives an empty reply", () => {
    expect(() => render("")).not.toThrow();
  });
});
