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

function render(content: string, citations: LexCitationEvent[] = []) {
  return renderToStaticMarkup(
    <MarkdownMessage content={content} citations={citations} />
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
