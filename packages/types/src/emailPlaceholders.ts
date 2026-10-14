/**
 * Photo placeholders in a campaign body.
 *
 * A placeholder is an <img> whose src is an inline SVG: the grey "your photo here" box that the
 * editor's templates and the campaign assistant both insert. Inboxes do not render inline SVG, so
 * a campaign still carrying one must not be sent. Shared by the editor (banner), the campaigns
 * list (chip), the send dialog (block) and the send endpoint (refusal), so all four agree on what
 * counts.
 */
export const IMAGE_PLACEHOLDER_SRC_PREFIX = "data:image/svg+xml";

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_RE = /\bsrc\s*=\s*["']([^"']*)["']/i;

export function isImagePlaceholderSrc(src: string | null | undefined): boolean {
  return (
    typeof src === "string" &&
    src.trim().toLowerCase().startsWith(IMAGE_PLACEHOLDER_SRC_PREFIX)
  );
}

/** How many photo spots are still the grey box. Regex-based so it runs the same on both sides. */
export function countImagePlaceholders(html: string): number {
  let count = 0;
  for (const match of html.matchAll(IMG_TAG_RE)) {
    const src = SRC_RE.exec(match[0]);
    if (src && isImagePlaceholderSrc(src[1])) count += 1;
  }
  return count;
}
