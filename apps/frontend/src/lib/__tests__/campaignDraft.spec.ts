import type { CampaignImageSlot } from "@packages/types";
import {
  emptySlotCount,
  isPlaceholderSrc,
  replaceSlotImage,
  slotStates
} from "../campaignDraft";

const PLACEHOLDER = "data:image/svg+xml;base64,PHN2Zy8+";
const PHOTO = "https://cdn.example.com/uploads/hero.jpg";

const slots: CampaignImageSlot[] = [
  { id: "hero", label: "Photo principale", description: "Le TM7 en cuisine" },
  { id: "recipe", label: "La recette" }
];

const html = [
  "<h1>Bonjour {{firstName}}</h1>",
  `<img data-slot="hero" src="${PLACEHOLDER}" alt="Photo principale" style="width:100%">`,
  "<p>Un texte &amp; une offre</p>",
  `<img data-slot="recipe" src="${PLACEHOLDER}" alt="La recette">`,
  '<p style="text-align: center"><a href="#">Découvrir</a></p>'
].join("");

describe("isPlaceholderSrc", () => {
  it("recognises the assistant's inline SVG", () => {
    expect(isPlaceholderSrc(PLACEHOLDER)).toBe(true);
    expect(isPlaceholderSrc("data:image/svg+xml;utf8,<svg/>")).toBe(true);
  });

  it("treats anything else as a real image", () => {
    expect(isPlaceholderSrc(PHOTO)).toBe(false);
    expect(isPlaceholderSrc("data:image/png;base64,AAAA")).toBe(false);
    expect(isPlaceholderSrc("")).toBe(false);
    expect(isPlaceholderSrc(null)).toBe(false);
    expect(isPlaceholderSrc(undefined)).toBe(false);
  });
});

describe("slotStates", () => {
  it("reports every slot as empty while the placeholders are in place", () => {
    expect(slotStates(html, slots)).toEqual([
      {
        id: "hero",
        label: "Photo principale",
        description: "Le TM7 en cuisine",
        filled: false,
        src: PLACEHOLDER
      },
      {
        id: "recipe",
        label: "La recette",
        description: undefined,
        filled: false,
        src: PLACEHOLDER
      }
    ]);
  });

  it("marks a slot filled once its image points at an upload", () => {
    const states = slotStates(replaceSlotImage(html, "hero", PHOTO), slots);
    expect(states[0]).toMatchObject({ id: "hero", filled: true, src: PHOTO });
    expect(states[1]).toMatchObject({ id: "recipe", filled: false });
  });

  it("counts a declared slot whose image was deleted as empty with no src", () => {
    const withoutRecipe = html.replace(
      `<img data-slot="recipe" src="${PLACEHOLDER}" alt="La recette">`,
      ""
    );
    expect(slotStates(withoutRecipe, slots)[1]).toEqual({
      id: "recipe",
      label: "La recette",
      description: undefined,
      filled: false,
      src: null
    });
  });

  it("appends slots the html carries but the draft did not declare", () => {
    // Only hero is declared; recipe exists in the html alone.
    const states = slotStates(html, [slots[0]]);
    expect(states.map((s) => s.id)).toEqual(["hero", "recipe"]);
    expect(states[1]).toEqual({
      id: "recipe",
      label: "recipe",
      description: undefined,
      filled: false,
      src: PLACEHOLDER
    });
  });

  it("reads an undeclared slot that already holds an upload as filled", () => {
    const states = slotStates(replaceSlotImage(html, "recipe", PHOTO), [
      slots[0]
    ]);
    expect(states[1]).toMatchObject({
      id: "recipe",
      label: "recipe",
      filled: true,
      src: PHOTO
    });
  });

  it("keeps the declared order and labels ahead of the html extras", () => {
    const reversed = [slots[1], slots[0]];
    expect(slotStates(html, reversed).map((s) => s.label)).toEqual([
      "La recette",
      "Photo principale"
    ]);
  });

  it("returns nothing when neither the draft nor the html has a slot", () => {
    expect(slotStates("<p>no images</p>", [])).toEqual([]);
  });
});

describe("replaceSlotImage", () => {
  it("swaps the src and keeps the other attributes", () => {
    const out = replaceSlotImage(html, "hero", PHOTO);
    expect(out).toContain(
      `<img data-slot="hero" src="${PHOTO}" alt="Photo principale" style="width:100%">`
    );
    expect(out).toContain(`<img data-slot="recipe" src="${PLACEHOLDER}"`);
  });

  it("preserves the surrounding markup, entities and template tokens", () => {
    const out = replaceSlotImage(html, "hero", PHOTO);
    expect(out).toContain("<h1>Bonjour {{firstName}}</h1>");
    expect(out).toContain("<p>Un texte &amp; une offre</p>");
    expect(out).toContain(
      '<p style="text-align: center"><a href="#">Découvrir</a></p>'
    );
  });

  it("returns the html untouched when the slot is missing", () => {
    expect(replaceSlotImage(html, "footer", PHOTO)).toBe(html);
  });

  it("can replace an already uploaded photo", () => {
    const once = replaceSlotImage(html, "hero", PHOTO);
    const twice = replaceSlotImage(
      once,
      "hero",
      "https://cdn.example.com/uploads/other.jpg"
    );
    expect(twice).toContain('src="https://cdn.example.com/uploads/other.jpg"');
    expect(twice).not.toContain(PHOTO);
  });
});

describe("emptySlotCount", () => {
  it("counts placeholders and missing images, not uploads", () => {
    expect(emptySlotCount(html, slots)).toBe(2);
    expect(emptySlotCount(replaceSlotImage(html, "hero", PHOTO), slots)).toBe(
      1
    );
    const bothFilled = replaceSlotImage(
      replaceSlotImage(html, "hero", PHOTO),
      "recipe",
      PHOTO
    );
    expect(emptySlotCount(bothFilled, slots)).toBe(0);
    expect(emptySlotCount("<p>no images</p>", slots)).toBe(2);
  });

  it("counts placeholders the draft never declared", () => {
    expect(emptySlotCount(html, [])).toBe(2);
    expect(emptySlotCount(html, [slots[0]])).toBe(2);
    expect(emptySlotCount("<p>no images</p>", [])).toBe(0);
  });
});
