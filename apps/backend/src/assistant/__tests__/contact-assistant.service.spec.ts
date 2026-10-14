import { BadRequestException } from "@nestjs/common";
import type { ContactGroup } from "@packages/types";
import type { ContactsService } from "../../contacts/contacts.service";
import type { GroupsService } from "../../groups/groups.service";
import type { MistralOcrService } from "../../shared/mistral-ocr.service";
import type { OpenAiService } from "../../shared/openai.service";
import {
  ContactAssistantService,
  isPlausibleEmail,
  normalizeSpokenEmail,
  sniffImageType,
  stripUrls
} from "../contact-assistant.service";

/** Bytes from a header (numbers or latin1 text) plus zero padding, without Buffer.concat, which the pinned @types/node rejects. */
function bytes(head: number[] | string, pad = 12): Buffer {
  const h = typeof head === "string" ? [...Buffer.from(head, "latin1")] : head;
  return Buffer.from([...h, ...new Array<number>(pad).fill(0)]);
}

/** A JPEG as far as the sniffer is concerned: the SOI marker, then padding. */
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 16);

const GROUPS: ContactGroup[] = [
  {
    id: "g1",
    name: "Thermomix",
    color: "green",
    createdAt: "",
    updatedAt: ""
  }
];

function build(opts: {
  responses?: string[];
  completeError?: Error;
  existing?: string[];
  ocrConfigured?: boolean;
  ocrText?: string;
  transcript?: string;
}) {
  const complete = jest.fn();
  if (opts.completeError) complete.mockRejectedValueOnce(opts.completeError);
  for (const r of opts.responses ?? []) complete.mockResolvedValueOnce(r);
  const transcribe = jest
    .fn()
    .mockResolvedValue({ text: opts.transcript ?? "", durationSeconds: 3 });
  const openai = { complete, transcribe } as unknown as OpenAiService;
  const ocr = {
    isConfigured: () => opts.ocrConfigured ?? false,
    ocr: jest.fn().mockResolvedValue([opts.ocrText ?? ""])
  } as unknown as MistralOcrService;
  const existing = new Set(opts.existing ?? []);
  const createConditional = jest.fn(async (contact: { emailLower: string }) => {
    if (existing.has(contact.emailLower)) {
      const err = new Error("The conditional request failed");
      err.name = "ConditionalCheckFailedException";
      throw err;
    }
  });
  const contacts = {
    get: jest.fn(async (emailLower: string) =>
      existing.has(emailLower)
        ? {
            emailLower,
            firstName: "Marie",
            lastName: "Dupont",
            status: "unsubscribed",
            groups: ["g1"]
          }
        : null
    ),
    createConditional
  } as unknown as ContactsService;
  const groups = {
    list: jest.fn().mockResolvedValue(GROUPS)
  } as unknown as GroupsService;
  return {
    svc: new ContactAssistantService(openai, ocr, contacts, groups),
    complete,
    transcribe,
    ocr,
    createConditional
  };
}

const TWO = JSON.stringify({
  summary: "Deux contacts trouvés.",
  contacts: [
    {
      firstName: "marie",
      lastName: "DUPONT",
      email: "Marie point Dupont arobase gmail point com",
      mobilePhone: "0470 12 34 56",
      groupNames: ["thermomix", "Atelier mars"],
      confidence: "high",
      issues: []
    },
    {
      firstName: "Jan",
      lastName: "Peeters",
      birthday: "12/03",
      groupNames: ["Atelier mars", "atelier MARS"],
      confidence: "low",
      issues: ["Nom difficile à lire"]
    }
  ]
});

describe("ContactAssistantService.extract", () => {
  it("rejects a request with nothing to read", async () => {
    const { svc } = build({});
    await expect(svc.extract({ language: "fr" })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("normalises spoken emails, maps groups, flags what to check", async () => {
    const { svc, complete } = build({ responses: [TWO], existing: [] });
    const out = await svc.extract({
      text: "Marie Dupont et Jan Peeters",
      language: "fr"
    });

    expect(out.summary).toBe("Deux contacts trouvés.");
    expect(out.transcript).toBeNull();
    expect(out.candidates).toHaveLength(2);

    const [marie, jan] = out.candidates;
    expect(marie.email).toBe("marie.dupont@gmail.com");
    expect(marie.groupIds).toEqual(["g1"]);
    expect(marie.newGroupNames).toEqual(["Atelier mars"]);
    expect(marie.existing).toBe(false);
    expect(marie.existingContact).toBeNull();
    expect(marie.issues).toEqual([]);

    expect(jan.email).toBe("");
    expect(jan.issues).toEqual(["Nom difficile à lire", "Aucun email lisible"]);
    expect(jan.birthday).toBeUndefined();
    // Case-insensitive de-dup within one candidate, and across the batch.
    expect(jan.newGroupNames).toEqual(["Atelier mars"]);
    expect(out.newGroupNames).toEqual(["Atelier mars"]);

    const call = complete.mock.calls[0][0];
    expect(call.json).toBe(true);
    expect(call.user).toContain("PASTED TEXT:\nMarie Dupont et Jan Peeters");
    expect(call.system).toContain('"Thermomix"');
    expect(call.requestOptions).toEqual({ timeoutMs: 120_000, maxRetries: 0 });
  });

  it("marks a candidate whose email already exists and says who that is", async () => {
    const { svc } = build({
      responses: [TWO],
      existing: ["marie.dupont@gmail.com"]
    });
    const out = await svc.extract({ text: "x", language: "fr" });
    expect(out.candidates[0].existing).toBe(true);
    expect(out.candidates[0].existingContact).toEqual({
      firstName: "Marie",
      lastName: "Dupont",
      status: "unsubscribed",
      groups: ["g1"]
    });
    expect(out.candidates[1].existingContact).toBeNull();
  });

  it("merges two rows with the same email into one card and says so", async () => {
    const { svc } = build({
      responses: [
        JSON.stringify({
          summary: "",
          contacts: [
            {
              firstName: "Marie",
              email: "marie@x.be",
              groupNames: ["A"],
              confidence: "high"
            },
            {
              lastName: "Dupont",
              email: "MARIE@x.be",
              mobilePhone: "0470",
              groupNames: ["b"],
              confidence: "low"
            },
            { firstName: "Jan", confidence: "high" }
          ]
        })
      ]
    });
    const out = await svc.extract({ text: "x", language: "fr" });
    expect(out.candidates).toHaveLength(2);
    expect(out.candidates[0]).toMatchObject({
      id: "c1",
      firstName: "Marie",
      lastName: "Dupont",
      mobilePhone: "0470",
      email: "marie@x.be",
      newGroupNames: ["A", "b"],
      confidence: "low"
    });
    expect(out.candidates[0].issues).toContain(
      "Apparaît 2 fois dans la source"
    );
    // A row without an email is never merged into anything.
    expect(out.candidates[1]).toMatchObject({
      id: "c2",
      firstName: "Jan",
      email: ""
    });
  });

  it("keeps links out of notes, issues and the summary", async () => {
    const { svc } = build({
      responses: [
        JSON.stringify({
          summary: "Un contact, voir https://evil.example/x",
          contacts: [
            {
              firstName: "A",
              email: "a@b.cd",
              notes: "vu sur www.site.be hier",
              issues: ["cf http://x.y"]
            }
          ]
        })
      ]
    });
    const out = await svc.extract({ text: "x", language: "fr" });
    expect(out.summary).toBe("Un contact, voir");
    expect(out.candidates[0].notes).toBe("vu sur hier");
    expect(out.candidates[0].issues).toEqual(["cf"]);
  });

  it("flags an implausible email instead of dropping the contact", async () => {
    const { svc } = build({
      responses: [
        JSON.stringify({
          summary: "",
          contacts: [
            { firstName: "A", email: "marie@gmail", confidence: "medium" }
          ]
        })
      ]
    });
    const out = await svc.extract({ text: "x", language: "nl" });
    expect(out.candidates[0].email).toBe("marie@gmail");
    expect(out.candidates[0].issues).toEqual([
      "E-mail te controleren: marie@gmail"
    ]);
  });

  it("transcribes a recording first and hands the transcript to the model", async () => {
    const { svc, complete, transcribe } = build({
      responses: [TWO],
      transcript: "Ajoute Marie Dupont"
    });
    const out = await svc.extract({
      file: {
        buffer: Buffer.from("audio"),
        mimetype: "audio/webm;codecs=opus",
        originalname: "voice.webm",
        size: 5
      },
      language: "fr"
    });
    expect(transcribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      "recording.webm",
      "audio/webm;codecs=opus",
      { timeoutMs: 60_000, maxRetries: 0 }
    );
    expect(out.transcript).toBe("Ajoute Marie Dupont");
    expect(complete.mock.calls[0][0].user).toContain(
      "TRANSCRIPT OF THE DICTATED NOTE:\nAjoute Marie Dupont"
    );
  });

  it("sends a photo as an image part, typed by its bytes rather than by the client", async () => {
    const { svc, complete } = build({ responses: [TWO] });
    await svc.extract({
      file: {
        buffer: JPEG,
        mimetype: "image/heic",
        originalname: "card.heic",
        size: JPEG.length
      },
      language: "fr"
    });
    const user = complete.mock.calls[0][0].user;
    expect(Array.isArray(user)).toBe(true);
    expect(user[1]).toEqual({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${JPEG.toString("base64")}`,
        detail: "high"
      }
    });
  });

  it("rejects an image whose bytes are not an image", async () => {
    const { svc } = build({});
    await expect(
      svc.extract({
        file: {
          buffer: Buffer.alloc(32),
          mimetype: "image/jpeg",
          originalname: "c.jpg",
          size: 32
        },
        language: "fr"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("falls back to OCR text when the vision call fails and OCR is configured", async () => {
    const { svc, complete, ocr } = build({
      completeError: new Error("image_url is not supported"),
      responses: [TWO],
      ocrConfigured: true,
      ocrText: "Marie Dupont\nmarie.dupont@gmail.com"
    });
    const out = await svc.extract({
      file: {
        buffer: JPEG,
        mimetype: "image/jpeg",
        originalname: "card.jpg",
        size: JPEG.length
      },
      language: "fr"
    });
    expect(ocr.ocr).toHaveBeenCalledWith(JPEG, "image/jpeg", "card.jpg");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0].user).toContain(
      "TEXT READ FROM THE PHOTO"
    );
    expect(out.candidates).toHaveLength(2);
  });

  it("rethrows a vision failure when OCR is not configured", async () => {
    const { svc } = build({
      completeError: new Error("image_url is not supported"),
      ocrConfigured: false
    });
    await expect(
      svc.extract({
        file: {
          buffer: JPEG,
          mimetype: "image/jpeg",
          originalname: "c.jpg",
          size: JPEG.length
        },
        language: "fr"
      })
    ).rejects.toThrow("image_url is not supported");
  });

  it("rejects an unsupported file type", async () => {
    const { svc } = build({});
    await expect(
      svc.extract({
        file: {
          buffer: Buffer.from("x"),
          mimetype: "application/pdf",
          originalname: "c.pdf",
          size: 1
        },
        language: "fr"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("ContactAssistantService.createMany", () => {
  it("creates new rows conditionally and reports the ones that already exist", async () => {
    const { svc, createConditional } = build({ existing: ["old@x.be"] });
    const out = await svc.createMany([
      { email: "New@x.be", firstName: "N", status: "subscribed" },
      { email: "old@x.be", firstName: "O", status: "subscribed" },
      { email: "new@X.be", status: "subscribed" }
    ]);
    expect(out.created).toHaveLength(1);
    expect(out.created[0]).toMatchObject({
      email: "New@x.be",
      emailLower: "new@x.be",
      firstName: "N",
      status: "subscribed",
      source: "admin"
    });
    expect(out.existing).toEqual(["old@x.be"]);
    expect(out.errors).toEqual([
      { email: "new@X.be", reason: "Listed twice in the request" }
    ]);
    // Never an unconditional put: the existing row is untouched.
    expect(createConditional).toHaveBeenCalledTimes(2);
  });
});

describe("sniffImageType", () => {
  it.each([
    [bytes([0xff, 0xd8, 0xff]), "image/jpeg"],
    [bytes([0x89, 0x50, 0x4e, 0x47]), "image/png"],
    [bytes("RIFF\0\0\0\0WEBP", 4), "image/webp"],
    [bytes("GIF89a"), "image/gif"],
    [Buffer.from("%PDF-1.4 something"), null],
    [Buffer.alloc(4), null]
  ])("reads the magic bytes (%#)", (buf, expected) => {
    expect(sniffImageType(buf)).toBe(expected);
  });
});

describe("stripUrls", () => {
  it("removes http and www links and tidies the spaces", () => {
    expect(stripUrls("voir https://a.b/c et www.d.e ici")).toBe("voir et ici");
  });
});

describe("normalizeSpokenEmail", () => {
  it.each([
    ["Marie point Dupont arobase gmail point com", "marie.dupont@gmail.com"],
    ["jan dot peeters at telenet dot be", "jan.peeters@telenet.be"],
    ["anne tiret marie arobase skynet point be", "anne-marie@skynet.be"],
    ["mailto:X@Y.be", "x@y.be"],
    ["a b @ c . d", "ab@c.d"]
  ])("%s → %s", (input, expected) => {
    expect(normalizeSpokenEmail(input)).toBe(expected);
  });
});

describe("isPlausibleEmail", () => {
  it.each([
    ["marie.dupont@gmail.com", true],
    ["a@b.c", true],
    ["marie@gmail", false],
    ["@gmail.com", false],
    ["marie dupont@gmail.com", false],
    ["", false]
  ])("%s → %s", (input, expected) => {
    expect(isPlausibleEmail(input)).toBe(expected);
  });
});

/** Review regressions. */
describe("normalizeSpokenEmail (already an address)", () => {
  it.each([
    ["marie.point@gmail.com", "marie.point@gmail.com"],
    ["jean-dash@x.be", "jean-dash@x.be"],
    ["info@punt.be", "info@punt.be"],
    ["At.Home@x.be", "at.home@x.be"]
  ])("leaves %s alone", (input, expected) => {
    expect(normalizeSpokenEmail(input)).toBe(expected);
  });
});

describe("ContactAssistantService.createMany (per-row validation)", () => {
  it("reports one bad row and still writes the others", async () => {
    const { svc, createConditional } = build({});
    const out = await svc.createMany([
      { email: "ok@x.be", firstName: "O", status: "subscribed" },
      { email: "marie..@gmail.com", firstName: "M" },
      { email: "fine@x.be", notes: "n".repeat(3000) }
    ]);
    expect(out.created.map((c) => c.email)).toEqual(["ok@x.be"]);
    expect(out.errors).toHaveLength(2);
    expect(out.errors[0]).toEqual({
      email: "marie..@gmail.com",
      reason: expect.stringMatching(/email/i)
    });
    expect(out.errors[1].email).toBe("fine@x.be");
    expect(createConditional).toHaveBeenCalledTimes(1);
  });
});

describe("ContactAssistantService.extract (empty recording)", () => {
  it("answers with no candidates and no model call when nothing was heard", async () => {
    const { svc, complete } = build({ transcript: "   " });
    const out = await svc.extract({
      file: {
        buffer: Buffer.from("audio"),
        mimetype: "audio/webm",
        originalname: "v.webm",
        size: 5
      },
      language: "fr"
    });
    expect(out).toEqual({
      candidates: [],
      transcript: "",
      summary: "",
      newGroupNames: []
    });
    expect(complete).not.toHaveBeenCalled();
  });
});
