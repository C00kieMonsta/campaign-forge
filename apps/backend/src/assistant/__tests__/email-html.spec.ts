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
