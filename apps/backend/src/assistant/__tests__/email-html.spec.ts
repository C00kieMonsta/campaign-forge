import {
  htmlToText,
  placeholderDataUri,
  resolveImageSlots,
  sanitizeEmailHtml
} from "../email-html";

/**
 * The draft is model output that ends up in the editor and then in real inboxes. The sanitizer is
 * the only thing standing between "the model was told not to" and "it did anyway".
 */
describe("sanitizeEmailHtml", () => {
  it("keeps the editor's vocabulary and inline text styles", () => {
    const html =
      '<h1 style="text-align: center"><span style="color: #558B2F">Titre</span></h1><p>Bonjour {{firstName}},</p><ul><li><strong>Un</strong></li></ul><hr><p><a href="https://example.com">Lien →</a></p>';
    const out = sanitizeEmailHtml(html);
    expect(out).toContain('<h1 style="text-align: center">');
    expect(out).toContain('<span style="color: #558B2F">Titre</span>');
    expect(out).toContain("<p>Bonjour {{firstName}},</p>");
    expect(out).toContain('<a href="https://example.com">Lien →</a>');
    expect(out).toContain("<hr />");
  });

  it("drops scripts, styles and iframes with their content", () => {
    const out = sanitizeEmailHtml(
      '<p>ok</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe><p>fin</p>'
    );
    expect(out).toBe("<p>ok</p><p>fin</p>");
  });

  it("removes event handlers and javascript: links", () => {
    const out = sanitizeEmailHtml(
      '<p onclick="steal()">x</p><a href="javascript:alert(1)">y</a><img src="x" onerror="z">'
    );
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("<a>y</a>");
  });

  it("unwraps unknown tags but keeps their text", () => {
    expect(
      sanitizeEmailHtml(
        "<section><p>texte</p></section><table><tr><td>cell</td></tr></table>"
      )
    ).toBe("<p>texte</p>cell");
  });

  it("keeps only safe style declarations", () => {
    const out = sanitizeEmailHtml(
      '<p style="color: red; background-image: url(x); position: fixed; font-size: 14px">a</p>'
    );
    expect(out).toBe('<p style="color: red; font-size: 14px">a</p>');
  });

  it("keeps placeholder, http and data:image sources on images and drops the rest", () => {
    expect(sanitizeEmailHtml('<img src="{{image:hero}}" alt="a">')).toBe(
      '<img src="{{image:hero}}" alt="a" />'
    );
    expect(
      sanitizeEmailHtml(
        '<img src="https://b.s3.amazonaws.com/x.jpg" data-slot="hero">'
      )
    ).toContain('data-slot="hero"');
    expect(sanitizeEmailHtml('<img src="file:///etc/passwd">')).toBe("<img />");
  });
});

describe("resolveImageSlots", () => {
  it("turns {{image:slug}} into a labelled placeholder carrying the slot id", () => {
    const { html, imageSlots } = resolveImageSlots(
      '<p>a</p><img src="{{image:recette}}" alt="x" /><p>b</p>',
      [
        {
          id: "recette",
          label: "Photo de la recette",
          description: "Le plat fini"
        }
      ]
    );
    expect(html).toMatch(
      /<img src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" alt="Photo de la recette" data-slot="recette"/
    );
    expect(html).toContain("<p>a</p>");
    expect(imageSlots).toEqual([
      {
        id: "recette",
        label: "Photo de la recette",
        description: "Le plat fini"
      }
    ]);
  });

  it("lists only the slots that are actually in the html, adding unlisted ones", () => {
    const { imageSlots } = resolveImageSlots('<img src="{{image:tm7}}" />', [
      { id: "recette", label: "Recette" }
    ]);
    expect(imageSlots).toEqual([{ id: "tm7", label: "tm7" }]);
  });

  it("adds a default width style when the model gave none", () => {
    const { html } = resolveImageSlots('<img src="{{image:a}}" />', []);
    expect(html).toContain("max-width: 600px");
  });

  it("strips a stray {{image:x}} left in text", () => {
    const { html } = resolveImageSlots("<p>voir {{image:x}} ici</p>", []);
    expect(html).toBe("<p>voir  ici</p>");
  });
});

describe("placeholderDataUri", () => {
  it("bakes the label into the SVG, escaped", () => {
    const uri = placeholderDataUri('Photo "été" <1>');
    const svg = Buffer.from(
      uri.replace("data:image/svg+xml;base64,", ""),
      "base64"
    ).toString("utf8");
    expect(svg).toContain("Photo &quot;été&quot; &lt;1&gt;");
    expect(svg.startsWith("<svg")).toBe(true);
  });
});

describe("htmlToText", () => {
  it("keeps paragraph breaks and decodes entities", () => {
    expect(htmlToText("<p>a &amp; b</p><p>c<br>d</p>")).toBe("a & b\nc\nd");
  });
});

/** Review regressions: the tokenising sanitizer and the slot bookkeeping. */
describe("sanitizeEmailHtml (tokeniser)", () => {
  it("cannot be spliced into a live tag by a stray '<' and a removed tag", () => {
    const out = sanitizeEmailHtml(
      '<p>Bonjour</p><<x>img src="https://t.example/p.png" onerror="alert(1)"><<x>style>body{display:none}<<x>/style>'
    );
    expect(out).not.toMatch(/<img/);
    expect(out).not.toMatch(/<style/);
    expect(out).toContain("&lt;img src=");
  });

  it("honours quotes, so a '>' inside an attribute does not end the tag", () => {
    expect(sanitizeEmailHtml('<p title="a>b">x</p>')).toBe("<p>x</p>");
    const out = sanitizeEmailHtml('<img alt="TM7 > TM6" src="{{image:tm7}}">');
    // Attribute order is kept as written; angle brackets never survive in alt text.
    expect(out).toBe('<img alt="TM7  TM6" src="{{image:tm7}}" />');
  });

  it("escapes angle brackets in text and keeps existing entities", () => {
    expect(sanitizeEmailHtml("<p>1 < 2 &amp; 3 > 2</p>")).toBe(
      "<p>1 &lt; 2 &amp; 3 &gt; 2</p>"
    );
  });

  it("drops a style value that smuggles an entity or a backslash", () => {
    expect(
      sanitizeEmailHtml('<p style="color: red&#59;background:url(x)">a</p>')
    ).toBe("<p>a</p>");
  });
});

describe("resolveImageSlots (review)", () => {
  it("lowercases the slug so the slot matches the declared one and passes the schema", () => {
    const { html, imageSlots } = resolveImageSlots(
      '<img src="{{image:Recette}}" alt="x" />',
      [{ id: "recette", label: "Photo de la recette" }]
    );
    expect(html).toContain('data-slot="recette"');
    expect(html).toContain('alt="Photo de la recette"');
    expect(imageSlots).toEqual([
      { id: "recette", label: "Photo de la recette" }
    ]);
  });

  it("keeps an uploaded photo's slot in the list, whatever the attribute order", () => {
    const { html, imageSlots } = resolveImageSlots(
      '<img data-slot="hero" src="https://x/y.jpg" alt="a" /><img src="{{image:tm7}}" />',
      [{ id: "hero", label: "Visuel principal" }]
    );
    expect(html).toContain('src="https://x/y.jpg"');
    expect(imageSlots).toEqual([
      { id: "hero", label: "Visuel principal" },
      { id: "tm7", label: "tm7" }
    ]);
  });

  it("does not leave a stray solidus inside the rebuilt tag", () => {
    const { html } = resolveImageSlots('<img src="{{image:a}}" alt="x" />', []);
    expect(html).not.toMatch(/\s\/\s/);
    expect(html).toMatch(/\/>$/);
  });

  it("removes a stray {{image:X}} in text regardless of case", () => {
    expect(resolveImageSlots("<p>voir {{image:Hero}}</p>", []).html).toBe(
      "<p>voir </p>"
    );
  });

  it("caps the slots at 20", () => {
    const html = Array.from(
      { length: 25 },
      (_, i) => `<img src="{{image:s${i}}}" />`
    ).join("");
    const { imageSlots, html: out } = resolveImageSlots(html, []);
    expect(imageSlots).toHaveLength(20);
    expect((out.match(/<img/g) ?? []).length).toBe(20);
  });
});
