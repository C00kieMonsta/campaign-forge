import type { CampaignImageSlot } from "@packages/types";

/**
 * What the model may put in an email body, and what it may not.
 *
 * The draft goes two places: a sandboxed preview iframe, and the Tiptap editor which the user then
 * sends to real inboxes. Neither should ever see a script, a frame, or an event handler, and the
 * model is given plain instructions to that effect, but instructions are not a guarantee. This is
 * the guarantee. It is a small tag allow-list rather than a general sanitizer because the editor
 * itself only understands this vocabulary.
 */
const ALLOWED_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "p",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "a",
  "img",
  "span",
  "blockquote",
  "div"
]);

/** Attributes kept per tag. Everything else, including every on* handler, is dropped. */
const ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
  a: new Set(["href", "style", "target"]),
  img: new Set(["src", "alt", "style", "width", "height", "data-slot"]),
  "*": new Set(["style"])
};

/** Only these style declarations survive. `expression()` and `url()` never reach an inbox. */
const ALLOWED_STYLE_PROPS = new Set([
  "color",
  "background-color",
  "text-align",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "margin",
  "margin-top",
  "margin-bottom",
  "padding",
  "width",
  "max-width",
  "height",
  "border-radius",
  "display",
  "text-decoration"
]);

/**
 * One token of the input: a comment, a tag (quote-aware, so a '>' inside an attribute value does
 * not end it), a run of text, or a lone '<' that starts no tag.
 *
 * Tokenising once is what makes the allow-list hold. A single search-and-replace over tags left
 * the text between them unexamined, so `<<x>img onerror=...>` had its unknown `<x>` removed and the
 * pieces on either side joined into a live tag.
 */
const TOKEN_RE =
  /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>|[^<]+|</g;
const ATTR_RE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
/** Tags whose whole content is dropped, not just the tags themselves. */
const DROP_WITH_CONTENT_RE =
  /<(script|style|iframe|object|embed|form|textarea|select|svg|math|title|head)\b[\s\S]*?<\/\1\s*>/gi;

function sanitizeStyle(value: string): string | null {
  const kept: string[] = [];
  for (const decl of value.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    // No entities and no escapes: a client decodes `&#59` before parsing the CSS, which would turn
    // one declaration into two. The allowed vocabulary never needs either character.
    if (/url\s*\(|expression\s*\(|javascript:|[\\&]/i.test(val)) continue;
    if (val.length === 0 || val.length > 100) continue;
    kept.push(`${prop}: ${val}`);
  }
  return kept.length ? kept.join("; ") : null;
}

function sanitizeUrl(value: string, tag: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  // Template variables and the placeholder convention are resolved later and pass through.
  if (/^\{\{[a-zA-Z0-9:_-]+\}\}$/.test(v)) return v;
  if (/^(https?:)?\/\//i.test(v)) return v;
  if (/^mailto:/i.test(v)) return v;
  if (
    tag === "img" &&
    /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(v)
  )
    return v;
  if (tag === "a" && v === "#") return v;
  return null;
}

function sanitizeAttrs(tag: string, raw: string): string {
  const allowed = ALLOWED_ATTRS[tag] ?? ALLOWED_ATTRS["*"];
  const out: string[] = [];
  for (const m of raw.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (!allowed.has(name)) continue;
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    let safe: string | null = value;
    if (name === "style") safe = sanitizeStyle(value);
    else if (name === "href" || name === "src") safe = sanitizeUrl(value, tag);
    else if (name === "target") safe = value === "_blank" ? "_blank" : null;
    else if (name === "data-slot")
      safe = /^[a-z0-9][a-z0-9-]{0,59}$/.test(value) ? value : null;
    else if (name === "width" || name === "height")
      safe = /^\d{1,4}(%|px)?$/.test(value) ? value : null;
    else safe = value.replace(/[<>"]/g, "").slice(0, 300);
    if (safe === null) continue;
    out.push(`${name}="${safe.replace(/"/g, "&quot;")}"`);
  }
  return out.length ? ` ${out.join(" ")}` : "";
}

/** Text between tags: angle brackets become entities, existing entities stay as they are. */
function escapeText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Reduces model-written HTML to the editor's vocabulary.
 *
 * Unknown tags are removed but their text is kept, so a stray <section> costs its wrapper and not
 * its paragraph. A handful of tags lose their content as well (script, style, iframe...), because
 * their text is not prose.
 */
export function sanitizeEmailHtml(input: string): string {
  const stripped = input.replace(DROP_WITH_CONTENT_RE, "");
  let out = "";
  for (const m of stripped.matchAll(TOKEN_RE)) {
    const token = m[0];
    if (token.startsWith("<!--")) continue;
    const rawTag = m[1];
    if (rawTag === undefined) {
      out += escapeText(token);
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (token.startsWith("</")) {
      out += `</${tag}>`;
      continue;
    }
    const selfClosing = tag === "br" || tag === "hr" || tag === "img";
    out += `<${tag}${sanitizeAttrs(tag, m[2] ?? "")}${selfClosing ? " /" : ""}>`;
  }
  return out.trim();
}

/** Characters that must be escaped inside SVG text. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A grey box that says which photo goes here, as a data URI the editor can show and the user can
 * replace. Same idea as the placeholder in the frontend's campaign templates, with the slot's
 * label baked in so "Votre image ici" becomes "Photo de la recette".
 */
export function placeholderDataUri(label: string): string {
  const text = escapeXml(label.slice(0, 60));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="220" viewBox="0 0 600 220">` +
    `<rect width="600" height="220" fill="#f0f0f0" rx="8"/>` +
    `<rect x="268" y="62" width="64" height="48" rx="6" fill="none" stroke="#bbbbbb" stroke-width="3"/>` +
    `<circle cx="300" cy="86" r="11" fill="none" stroke="#bbbbbb" stroke-width="3"/>` +
    `<text x="300" y="150" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#9a9a9a" text-anchor="middle">${text}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** Slots per draft. The UI lists them one by one; past this it is not an email any more. */
export const MAX_IMAGE_SLOTS = 20;

/** Lazy attribute group, and the self-closing solidus absorbed so it is not read as an attribute. */
export const IMG_TAG_RE = /<img\b([^>]*?)\s*\/?>/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*"([^"]*)"/i;
const SLOT_ATTR_RE = /\bdata-slot\s*=\s*"([^"]*)"/i;
const PLACEHOLDER_SRC_RE = /^\{\{image:([a-z0-9][a-z0-9-]*)\}\}$/i;
const SLOT_TEXT_RE = /\{\{image:[a-z0-9][a-z0-9-]*\}\}/gi;

/** The slot id as the schema accepts it: lowercase, ascii, dashes, at most 60 characters. */
export function slugifySlotId(id: string): string {
  const slug = id
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "photo";
}

/** The src and data-slot of one <img> tag's attribute string, whatever their order. */
export function imageAttrs(attrs: string): {
  src: string;
  slot: string | null;
} {
  const slot = SLOT_ATTR_RE.exec(attrs)?.[1] ?? null;
  return {
    src: (SRC_ATTR_RE.exec(attrs)?.[1] ?? "").trim(),
    slot: slot ? slugifySlotId(slot) : null
  };
}

/**
 * Turns `{{image:slug}}` sources into labelled placeholders and keeps the slot list honest.
 *
 * Returns the html with every placeholder resolved and the slots that are actually present in it:
 * the placeholders, plus the photos already uploaded into a slot (an https src with a data-slot),
 * so the Photos tab keeps showing them as filled. A slot the model listed but never placed is
 * dropped; a slug it placed but never listed is added with the slug as its label.
 */
export function resolveImageSlots(
  html: string,
  declared: CampaignImageSlot[]
): { html: string; imageSlots: CampaignImageSlot[] } {
  const byId = new Map(declared.map((s) => [s.id, s]));
  const placed: CampaignImageSlot[] = [];
  const seen = new Set<string>();
  const slotFor = (id: string): CampaignImageSlot =>
    byId.get(id) ?? { id, label: id.replace(/-/g, " ") };
  const record = (id: string): boolean => {
    if (seen.has(id)) return true;
    if (placed.length >= MAX_IMAGE_SLOTS) return false;
    seen.add(id);
    placed.push(slotFor(id));
    return true;
  };

  const out = html.replace(IMG_TAG_RE, (whole, attrs: string) => {
    const { src, slot } = imageAttrs(attrs);
    const placeholder = PLACEHOLDER_SRC_RE.exec(src);
    if (!placeholder) {
      if (slot && /^https?:\/\//i.test(src)) record(slot);
      return whole;
    }
    const id = slugifySlotId(placeholder[1]);
    // Past the cap the tag goes, rather than a placeholder the list cannot show.
    if (!record(id)) return "";
    const resolved = slotFor(id);
    let rest = attrs
      .replace(/\bsrc\s*=\s*"[^"]*"/i, "")
      .replace(/\bdata-slot\s*=\s*"[^"]*"/i, "")
      .replace(/\balt\s*=\s*"[^"]*"/i, "")
      .trim();
    if (!/\bstyle\s*=/i.test(rest)) {
      rest = `${rest} style="width: 100%; max-width: 600px; display: block; margin: 16px auto; border-radius: 8px"`;
    }
    return `<img src="${placeholderDataUri(resolved.label)}" alt="${escapeXml(resolved.label)}" data-slot="${id}"${rest.trim() ? ` ${rest.trim()}` : ""} />`;
  });

  // Any bare `{{image:x}}` left outside an <img> (the model put it in text) is removed.
  return { html: out.replace(SLOT_TEXT_RE, ""), imageSlots: placed };
}

/** Plain text of an html fragment, for logging and for the model's own summary. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
