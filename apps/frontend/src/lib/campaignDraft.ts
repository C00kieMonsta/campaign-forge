import type { CampaignImageSlot } from "@packages/types";

export interface SlotState {
  id: string;
  label: string;
  description?: string;
  /** The slot shows a real image, not the assistant's grey placeholder. */
  filled: boolean;
  /** The current `src` of the slot's image, or null when the image is gone from the html. */
  src: string | null;
}

/** The assistant marks an unfilled slot with an inline SVG placeholder. */
export function isPlaceholderSrc(src: string | null | undefined): boolean {
  return typeof src === "string" && src.startsWith("data:image/svg+xml");
}

// A template parses the fragment without running scripts or loading images.
function parseFragment(html: string): HTMLTemplateElement {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template;
}

// Compared by attribute rather than selector, so no id needs escaping. Document order.
function slotImages(root: ParentNode): Map<string, HTMLImageElement> {
  const images = new Map<string, HTMLImageElement>();
  for (const img of Array.from(
    root.querySelectorAll<HTMLImageElement>("img[data-slot]")
  )) {
    const id = img.getAttribute("data-slot");
    if (id && !images.has(id)) images.set(id, img);
  }
  return images;
}

function toState(
  slot: CampaignImageSlot,
  img: HTMLImageElement | undefined
): SlotState {
  const src = img ? img.getAttribute("src") : null;
  return {
    id: slot.id,
    label: slot.label,
    description: slot.description,
    filled: Boolean(src) && !isPlaceholderSrc(src),
    src
  };
}

/**
 * The declared slots in their order, then any `data-slot` image the html carries that was not
 * declared, labelled by its id. The html is the truth about which slots exist.
 */
export function slotStates(
  html: string,
  slots: CampaignImageSlot[]
): SlotState[] {
  const images = slotImages(parseFragment(html).content);
  const declared = new Set(slots.map((slot) => slot.id));
  const states = slots.map((slot) => toState(slot, images.get(slot.id)));
  for (const [id, img] of images) {
    if (!declared.has(id)) states.push(toState({ id, label: id }, img));
  }
  return states;
}

/** Points the slot's image at `url`. Everything else in the html is kept as it was. */
export function replaceSlotImage(
  html: string,
  slotId: string,
  url: string
): string {
  const template = parseFragment(html);
  const img = slotImages(template.content).get(slotId);
  if (!img) return html;
  img.setAttribute("src", url);
  return template.innerHTML;
}

export function emptySlotCount(
  html: string,
  slots: CampaignImageSlot[]
): number {
  return slotStates(html, slots).filter((slot) => !slot.filled).length;
}
