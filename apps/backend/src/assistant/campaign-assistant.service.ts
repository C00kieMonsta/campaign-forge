import { Injectable, Logger } from "@nestjs/common";
import {
  campaignDraftSchema,
  campaignImageSlotSchema,
  type CampaignAssistantTurnRequest,
  type CampaignAssistantTurnResponse,
  type CampaignDraft,
  type ContactGroup
} from "@packages/types";
import { z } from "zod";
import { GroupsService } from "../groups/groups.service";
import { OpenAiService } from "../shared/openai.service";
import {
  imageAttrs,
  IMG_TAG_RE,
  resolveImageSlots,
  sanitizeEmailHtml,
  slugifySlotId
} from "./email-html";
import { LANGUAGE_NAMES, ModelOutputError, parseModelJson } from "./model-json";

/**
 * What the model must answer with. Looser than the public draft schema on purpose: a slot with a
 * bad slug or an unknown group id is repaired below rather than failing the whole turn.
 */
const modelOutputSchema = z.object({
  reply: z.string().min(1).max(4000),
  draft: z
    .object({
      name: z.string().min(1).max(200),
      subject: z.string().min(1).max(200),
      html: z.string().min(1).max(500000),
      targetGroupIds: z.array(z.string()).max(50).optional(),
      imageSlots: z
        .array(
          z.object({
            id: z.string().min(1).max(80),
            label: z.string().min(1).max(120),
            description: z.string().max(400).optional()
          })
        )
        .max(20)
        .optional()
    })
    .nullable()
    .optional()
});
type ModelOutput = z.infer<typeof modelOutputSchema>;
type ModelDraft = NonNullable<ModelOutput["draft"]>;

/** Prose budget for one turn: a full newsletter is ~2.5k tokens, with room for a long reply. */
const TURN_PROSE_TOKENS = 6000;
/**
 * A person is waiting on this call. No SDK retries: the service retries once itself on a bad
 * answer, so the worst case is two of these, under the client's 300 s and nginx's 600 s.
 */
const CALL_TIMEOUT_MS = 120_000;

const PLACEHOLDER_SRC = /^data:image\/svg\+xml/i;

/**
 * The draft as the model should see it again: placeholders back to `{{image:slug}}`.
 *
 * A placeholder is a few kilobytes of base64 and there may be three of them; sending those back
 * every turn would spend the prompt on grey rectangles. Uploaded photos keep their short URL.
 */
export function compactDraftHtml(html: string): string {
  return html.replace(IMG_TAG_RE, (whole, attrs: string) => {
    const { src, slot } = imageAttrs(attrs);
    if (!slot || !PLACEHOLDER_SRC.test(src)) return whole;
    return `<img src="{{image:${slot}}}" alt="${slot}" />`;
  });
}

/**
 * Keeps the photos the user already uploaded when the model rewrites the draft.
 *
 * The model is told to keep uploaded URLs, but it sees the html as text and a revision of the
 * paragraph next to a photo is enough for it to emit the `{{image:slug}}` form again. The slot id
 * survives either way, so a slot that had a real image before keeps it. Attribute order does not
 * matter: the model may write data-slot before src and the sanitizer keeps what it wrote.
 */
export function carryUploadedImages(
  previousHtml: string | null,
  nextHtml: string
): string {
  if (!previousHtml) return nextHtml;
  const uploaded = new Map<string, string>();
  for (const m of previousHtml.matchAll(IMG_TAG_RE)) {
    const { src, slot } = imageAttrs(m[1]);
    if (slot && /^https?:\/\//i.test(src)) uploaded.set(slot, src);
  }
  if (uploaded.size === 0) return nextHtml;
  return nextHtml.replace(IMG_TAG_RE, (whole, attrs: string) => {
    const { src, slot } = imageAttrs(attrs);
    const url = slot ? uploaded.get(slot) : undefined;
    if (!url || !PLACEHOLDER_SRC.test(src)) return whole;
    const restored = attrs.replace(/\bsrc\s*=\s*"[^"]*"/i, `src="${url}"`);
    return `<img ${restored.trim()} />`;
  });
}

export function buildSystemPrompt(params: {
  language: "fr" | "nl";
  groups: ContactGroup[];
  draft: CampaignDraft | null;
}): string {
  const lang = LANGUAGE_NAMES[params.language];
  const greeting =
    params.language === "nl" ? "Dag {{firstName}}," : "Bonjour {{firstName}},";
  const signoff =
    params.language === "nl"
      ? "Hartelijke groeten,<br>Monique Pirson"
      : "Cordialement,<br>Monique Pirson";
  const groups =
    params.groups.length === 0
      ? "(no groups exist yet; always use [])"
      : params.groups.map((g) => `- ${g.id} → "${g.name}"`).join("\n");
  const current = params.draft
    ? JSON.stringify({
        name: params.draft.name,
        subject: params.draft.subject,
        targetGroupIds: params.draft.targetGroupIds,
        imageSlots: params.draft.imageSlots,
        html: compactDraftHtml(params.draft.html)
      })
    : "none yet";

  return [
    `You are the campaign assistant inside Campaign Forge, the newsletter tool of Monique Pirson, an independent Thermomix® consultant in Belgium. She writes to her customers and prospects: warm, personal, concise, in the "vous" form. Her emails are in French unless she asks for Dutch.`,
    ``,
    `Your job: turn her description into a complete email campaign, then refine it on request.`,
    ``,
    `Answer EVERY turn with ONE JSON object: {"reply": string, "draft": object | null}.`,
    `- "reply": a short chat message in ${lang}, Markdown allowed, at most 80 words. Say what you did, or ask at most two precise questions when something essential is missing (the occasion, the offer). Never paste the email into the reply. If you used a bracketed placeholder in the email, say which ones she must fill in.`,
    `- "draft": the FULL campaign after this turn, or null when you only asked a question and have nothing to show yet. When she asks for a change, return the entire draft again with the change applied and everything else kept. Fields:`,
    `  - "name": internal campaign name, max 60 characters (e.g. "Newsletter mars – promo TM7").`,
    `  - "subject": the email subject line, max 70 characters, no clickbait, at most one emoji.`,
    `  - "html": the email body (rules below).`,
    `  - "targetGroupIds": ids from GROUPS that match who she said the email is for; [] when she means everyone or did not say.`,
    `  - "imageSlots": one entry per photo placeholder in the html: {"id": slug, "label": short ${lang} label shown to her (e.g. "Photo de la recette"), "description": what photo to take, one sentence}.`,
    ``,
    `HTML RULES`,
    `- Simple HTML only: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <a> <img> <hr> <br>. No <html>, <head>, <body>, <table>, <div>, <section>, CSS classes, <style> or <script>.`,
    `- Inline style only for text-align, color and font-size. Headings carry the brand green: <h1 style="text-align: center"><span style="color: #558B2F">Titre</span></h1>, <h2><span style="color: #558B2F">Sous-titre</span></h2>.`,
    `- Start with <p>${greeting}</p>. Personalisation variables allowed: {{firstName}}, {{lastName}}, {{displayName}}, {{email}}, {{organization}}. No other variables.`,
    `- Photos: wherever a photo belongs (a dish, a product, an event, the main visual), insert exactly one <img src="{{image:slug}}" alt="short description" /> with a lowercase slug such as {{image:recette}} or {{image:tm7}}, and describe it in imageSlots. One to three photos per email. Never invent an image URL. Keep any existing <img src="https://..." data-slot="..."> exactly as it is: it is a photo she already uploaded.`,
    `- Links: <a href="#">Texte du lien →</a> when she gave no URL; her URL when she gave one.`,
    `- Short paragraphs, lists for offers and recipe steps, a <hr /> between sections, and end with <p>${signoff}</p>.`,
    `- Length: a newsletter 150 to 350 words; a short announcement 60 to 150 words.`,
    `- No unsubscribe line and no footer: the tool adds them.`,
    `- Do not invent prices, dates, product names or offers she did not state. Write a bracketed placeholder such as [prix] or [date] instead and tell her in the reply.`,
    ``,
    `GROUPS (id → name):`,
    groups,
    ``,
    `CURRENT DRAFT (JSON):`,
    current
  ].join("\n");
}

@Injectable()
export class CampaignAssistantService {
  private readonly logger = new Logger(CampaignAssistantService.name);

  constructor(
    private openai: OpenAiService,
    private groups: GroupsService
  ) {}

  async turn(
    req: CampaignAssistantTurnRequest
  ): Promise<CampaignAssistantTurnResponse> {
    const started = Date.now();
    const groups = await this.groups.list();
    const previous = req.draft ?? null;
    const system = buildSystemPrompt({
      language: req.language,
      groups,
      draft: previous
    });

    // The last message is the question; everything before it is history. A trailing assistant
    // message (the client retrying after an error) is sent as history with a nudge to continue.
    const messages = req.messages;
    const last = messages[messages.length - 1];
    const history =
      last.role === "user" ? messages.slice(0, -1) : messages.slice();
    const user =
      last.role === "user"
        ? last.content
        : req.language === "nl"
          ? "Ga verder."
          : "Continue.";

    const result = await this.completeWithOneRetry({
      system,
      history,
      user,
      // A revision rewrites a draft that exists; medium effort buys nothing there and the turn
      // has to come back before the client gives up on it.
      depth: previous ? "quick" : "standard",
      // Parsing AND finishing, so a draft that is unusable after sanitising (an empty body, a
      // slot id the schema rejects) is retried like a malformed answer rather than sent back.
      validate: (raw) => {
        const parsed = parseModelJson(raw, modelOutputSchema);
        return {
          reply: parsed.reply.trim(),
          draft: parsed.draft
            ? this.finishDraft(parsed.draft, groups, previous)
            : null
        };
      }
    });

    this.logger.log(
      JSON.stringify({
        action: "campaignAssistantTurn",
        turns: messages.length,
        language: req.language,
        hadDraft: previous !== null,
        draft: result.draft !== null,
        slots: result.draft?.imageSlots.length ?? 0,
        htmlChars: result.draft?.html.length ?? 0,
        ms: Date.now() - started
      })
    );

    return result;
  }

  /**
   * One retry on an unusable answer, with the failure quoted back. JSON mode makes a parse failure
   * rare; a shape failure (a draft with no html) is the one that happens, and the second attempt
   * nearly always fixes it. A second failure is reported, not retried again.
   */
  private async completeWithOneRetry<T>(params: {
    system: string;
    history: { role: "user" | "assistant"; content: string }[];
    user: string;
    depth: "quick" | "standard";
    validate: (raw: string) => T;
  }): Promise<T> {
    const call = (user: string) =>
      this.openai.complete({
        system: params.system,
        history: params.history,
        user,
        json: true,
        tier: "balanced",
        depth: params.depth,
        maxTokens: TURN_PROSE_TOKENS,
        requestOptions: { timeoutMs: CALL_TIMEOUT_MS, maxRetries: 0 }
      });
    const first = await call(params.user);
    try {
      return params.validate(first);
    } catch (err) {
      if (!(err instanceof ModelOutputError)) throw err;
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "campaignAssistantRetry",
          error: err.message,
          sample: err.sample.slice(0, 200)
        })
      );
      const second = await call(
        `${params.user}\n\n(Your previous answer was rejected: ${err.message}. Answer again with exactly the JSON object described, including a complete "draft" with "html".)`
      );
      return params.validate(second);
    }
  }

  private finishDraft(
    draft: ModelDraft,
    groups: ContactGroup[],
    previous: CampaignDraft | null
  ): CampaignDraft {
    const knownGroupIds = new Set(groups.map((g) => g.id));
    // The previous draft's slots first, the model's on top: a revision that omits imageSlots or
    // lists a subset keeps the labels and descriptions she already saw.
    const declared = [
      ...(previous?.imageSlots ?? []),
      ...(draft.imageSlots ?? []).flatMap((s) => {
        const parsed = campaignImageSlotSchema.safeParse({
          ...s,
          id: slugifySlotId(s.id)
        });
        return parsed.success ? [parsed.data] : [];
      })
    ];

    // Sanitize first so the placeholder we insert is never itself subject to the filter, then
    // resolve the slots, then put back whatever she had already uploaded.
    const sanitized = sanitizeEmailHtml(draft.html);
    const resolved = resolveImageSlots(sanitized, declared);
    const html = carryUploadedImages(previous?.html ?? null, resolved.html);

    const finished = campaignDraftSchema.safeParse({
      name: draft.name.trim().slice(0, 200),
      subject: draft.subject.trim().slice(0, 200),
      html,
      targetGroupIds: [
        ...new Set(
          (draft.targetGroupIds ?? []).filter((id) => knownGroupIds.has(id))
        )
      ],
      imageSlots: resolved.imageSlots
    });
    if (!finished.success) {
      throw new ModelOutputError(
        `The draft is not usable after cleaning: ${finished.error.errors
          .slice(0, 3)
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ")}`,
        draft.html.slice(0, 500)
      );
    }
    return finished.data;
  }
}
