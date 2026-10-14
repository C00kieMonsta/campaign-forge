import type { ContactGroup } from "@packages/types";
import type { GroupsService } from "../../groups/groups.service";
import type { OpenAiService } from "../../shared/openai.service";
import {
  buildSystemPrompt,
  CampaignAssistantService,
  carryUploadedImages,
  compactDraftHtml
} from "../campaign-assistant.service";
import { ModelOutputError } from "../model-json";

const GROUPS: ContactGroup[] = [
  {
    id: "g1",
    name: "Clients TM7",
    color: "green",
    createdAt: "",
    updatedAt: ""
  },
  { id: "g2", name: "Prospects", color: "blue", createdAt: "", updatedAt: "" }
];

function service(responses: string[]) {
  const complete = jest.fn();
  for (const r of responses) complete.mockResolvedValueOnce(r);
  const openai = { complete } as unknown as OpenAiService;
  const groups = {
    list: jest.fn().mockResolvedValue(GROUPS)
  } as unknown as GroupsService;
  return { svc: new CampaignAssistantService(openai, groups), complete };
}

const GOOD = JSON.stringify({
  reply: "Voici une première version.",
  draft: {
    name: "Newsletter mars",
    subject: "Les promos de mars 🌷",
    html: '<h1 style="text-align: center"><span style="color: #558B2F">Mars</span></h1><p>Bonjour {{firstName}},</p><img src="{{image:recette}}" alt="recette" /><p>Cordialement,<br>Monique Pirson</p><script>x()</script>',
    targetGroupIds: ["g1", "nope"],
    imageSlots: [
      { id: "Recette", label: "Photo de la recette", description: "Le plat" }
    ]
  }
});

describe("CampaignAssistantService.turn", () => {
  it("returns a sanitized draft with resolved placeholders and only known groups", async () => {
    const { svc, complete } = service([GOOD]);
    const out = await svc.turn({
      messages: [
        { role: "user", content: "Une newsletter de mars avec ma recette" }
      ],
      draft: null,
      language: "fr"
    });

    expect(out.reply).toBe("Voici une première version.");
    expect(out.draft).not.toBeNull();
    expect(out.draft!.html).not.toContain("<script");
    expect(out.draft!.html).toMatch(/data-slot="recette"/);
    expect(out.draft!.html).toMatch(/src="data:image\/svg\+xml;base64,/);
    expect(out.draft!.targetGroupIds).toEqual(["g1"]);
    expect(out.draft!.imageSlots).toEqual([
      { id: "recette", label: "Photo de la recette", description: "Le plat" }
    ]);

    // The request shape: balanced tier, JSON mode, history separate from the question.
    const call = complete.mock.calls[0][0];
    expect(call.json).toBe(true);
    expect(call.tier).toBe("balanced");
    expect(call.user).toBe("Une newsletter de mars avec ma recette");
    expect(call.history).toEqual([]);
    expect(call.system).toContain('g1 → "Clients TM7"');
  });

  it("sends earlier turns as history and the current draft compacted", async () => {
    const { svc, complete } = service([GOOD]);
    const placeholder = `<img src="data:image/svg+xml;base64,QUJD" alt="x" data-slot="hero" />`;
    await svc.turn({
      messages: [
        { role: "user", content: "première demande" },
        { role: "assistant", content: "voici" },
        { role: "user", content: "plus court" }
      ],
      draft: {
        name: "n",
        subject: "s",
        html: `<p>a</p>${placeholder}`,
        targetGroupIds: [],
        imageSlots: [{ id: "hero", label: "Hero" }]
      },
      language: "fr"
    });
    const call = complete.mock.calls[0][0];
    expect(call.history).toEqual([
      { role: "user", content: "première demande" },
      { role: "assistant", content: "voici" }
    ]);
    expect(call.user).toBe("plus court");
    expect(call.system).toContain("{{image:hero}}");
    expect(call.system).not.toContain("QUJD");
  });

  it("returns a null draft when the assistant only asked a question", async () => {
    const { svc } = service([
      JSON.stringify({ reply: "Pour quelle occasion ?", draft: null })
    ]);
    const out = await svc.turn({
      messages: [{ role: "user", content: "une campagne" }],
      language: "fr"
    });
    expect(out).toEqual({ reply: "Pour quelle occasion ?", draft: null });
  });

  it("retries once on an unusable answer, then reports it", async () => {
    const { svc, complete } = service(["not json at all", '{"reply": ""}']);
    await expect(
      svc.turn({ messages: [{ role: "user", content: "x" }], language: "fr" })
    ).rejects.toBeInstanceOf(ModelOutputError);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0].user).toContain(
      "previous answer was rejected"
    );
  });

  it("keeps a photo the user already uploaded when the model rewrites the draft", async () => {
    const { svc } = service([GOOD]);
    const out = await svc.turn({
      messages: [{ role: "user", content: "plus court" }],
      draft: {
        name: "n",
        subject: "s",
        html: '<p>x</p><img src="https://bucket.s3.eu-north-1.amazonaws.com/abc.jpg" alt="recette" data-slot="recette" style="width: 100%" />',
        targetGroupIds: [],
        imageSlots: [{ id: "recette", label: "Photo de la recette" }]
      },
      language: "fr"
    });
    expect(out.draft!.html).toContain(
      'src="https://bucket.s3.eu-north-1.amazonaws.com/abc.jpg"'
    );
    expect(out.draft!.html).not.toMatch(/data-slot="recette"[^>]*src="data:/);
  });
});

describe("compactDraftHtml", () => {
  it("replaces placeholder images by the {{image:slug}} form and leaves uploads alone", () => {
    const html =
      '<img src="data:image/svg+xml;base64,QUJD" alt="a" data-slot="hero" style="width: 100%" /><img src="https://x/y.jpg" data-slot="tm7" />';
    expect(compactDraftHtml(html)).toBe(
      '<img src="{{image:hero}}" alt="hero" /><img src="https://x/y.jpg" data-slot="tm7" />'
    );
  });
});

describe("carryUploadedImages", () => {
  it("restores an uploaded src onto the same slot in the new html", () => {
    const prev = '<img src="https://x/y.jpg" alt="a" data-slot="hero" />';
    const next =
      '<p>new</p><img src="data:image/svg+xml;base64,QUJD" alt="Hero" data-slot="hero" style="width: 100%" />';
    const out = carryUploadedImages(prev, next);
    expect(out).toContain('src="https://x/y.jpg"');
    expect(out).toContain('data-slot="hero"');
    expect(out).toContain('style="width: 100%"');
    expect(out).toContain("<p>new</p>");
  });

  it("does nothing without a previous draft or when the slot is gone", () => {
    expect(carryUploadedImages(null, "<p>a</p>")).toBe("<p>a</p>");
    expect(
      carryUploadedImages(
        '<img src="https://x/y.jpg" data-slot="hero" />',
        "<p>a</p>"
      )
    ).toBe("<p>a</p>");
  });
});

describe("buildSystemPrompt", () => {
  it("names the groups, the language and the placeholder convention", () => {
    const prompt = buildSystemPrompt({
      language: "nl",
      groups: GROUPS,
      draft: null
    });
    expect(prompt).toContain("Dutch");
    expect(prompt).toContain('g2 → "Prospects"');
    expect(prompt).toContain("{{image:slug}}");
    expect(prompt).toContain("Dag {{firstName}},");
    expect(prompt).toContain("none yet");
  });
});

/** Review regressions. */
describe("carryUploadedImages (attribute order)", () => {
  it("restores an upload written with data-slot before src", () => {
    const prev = '<img data-slot="hero" src="https://x/y.jpg" />';
    const next =
      '<img src="data:image/svg+xml;base64,QUJD" alt="Hero" data-slot="hero" />';
    expect(carryUploadedImages(prev, next)).toContain('src="https://x/y.jpg"');
  });
});

describe("CampaignAssistantService.turn (review)", () => {
  it("keeps the previous slot labels when a revision omits imageSlots", async () => {
    const { svc } = service([
      JSON.stringify({
        reply: "Plus court.",
        draft: {
          name: "n",
          subject: "s",
          html: '<p>court</p><img src="{{image:recette}}" alt="r" />'
        }
      })
    ]);
    const out = await svc.turn({
      messages: [{ role: "user", content: "plus court" }],
      draft: {
        name: "n",
        subject: "s",
        html: '<p>long</p><img src="data:image/svg+xml;base64,QUJD" alt="Photo de la recette" data-slot="recette" />',
        targetGroupIds: [],
        imageSlots: [
          {
            id: "recette",
            label: "Photo de la recette",
            description: "Le plat fini"
          }
        ]
      },
      language: "fr"
    });
    expect(out.draft!.imageSlots).toEqual([
      {
        id: "recette",
        label: "Photo de la recette",
        description: "Le plat fini"
      }
    ]);
    expect(out.draft!.html).toContain('alt="Photo de la recette"');
  });

  it("retries when the draft is unusable after cleaning, then reports it", async () => {
    const empty = JSON.stringify({
      reply: "ok",
      draft: { name: "n", subject: "s", html: "<script>x()</script>" }
    });
    const { svc, complete } = service([empty, empty]);
    await expect(
      svc.turn({ messages: [{ role: "user", content: "x" }], language: "fr" })
    ).rejects.toBeInstanceOf(ModelOutputError);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][0].requestOptions).toEqual({
      timeoutMs: 120_000,
      maxRetries: 0
    });
  });

  it("uses low effort for a revision and medium for a first draft", async () => {
    const { svc, complete } = service([GOOD, GOOD]);
    const first = await svc.turn({
      messages: [{ role: "user", content: "x" }],
      language: "fr"
    });
    await svc.turn({
      messages: [{ role: "user", content: "y" }],
      draft: first.draft,
      language: "fr"
    });
    expect(complete.mock.calls[0][0].depth).toBe("standard");
    expect(complete.mock.calls[1][0].depth).toBe("quick");
  });
});
