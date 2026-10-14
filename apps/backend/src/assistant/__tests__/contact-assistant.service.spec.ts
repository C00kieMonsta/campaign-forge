import { BadRequestException } from "@nestjs/common";
import type { ContactGroup } from "@packages/types";
import type { ContactsService } from "../../contacts/contacts.service";
import type { GroupsService } from "../../groups/groups.service";
import type { MistralOcrService } from "../../shared/mistral-ocr.service";
import type { OpenAiService } from "../../shared/openai.service";
import {
  ContactAssistantService,
  isPlausibleEmail,
  normalizeSpokenEmail
} from "../contact-assistant.service";

const GROUPS: ContactGroup[] = [
  { id: "g1", name: "Thermomix", color: "green", createdAt: "", updatedAt: "" }
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
  const contacts = {
    get: jest.fn(async (emailLower: string) =>
      existing.has(emailLower) ? { emailLower } : null
    )
  } as unknown as ContactsService;
  const groups = {
    list: jest.fn().mockResolvedValue(GROUPS)
  } as unknown as GroupsService;
  return {
    svc: new ContactAssistantService(openai, ocr, contacts, groups),
    complete,
    transcribe,
    ocr
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
  });

  it("marks a candidate whose email already exists", async () => {
    const { svc } = build({
      responses: [TWO],
      existing: ["marie.dupont@gmail.com"]
    });
    const out = await svc.extract({ text: "x", language: "fr" });
    expect(out.candidates[0].existing).toBe(true);
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
      "audio/webm;codecs=opus"
    );
    expect(out.transcript).toBe("Ajoute Marie Dupont");
    expect(complete.mock.calls[0][0].user).toContain(
      "TRANSCRIPT OF THE DICTATED NOTE:\nAjoute Marie Dupont"
    );
  });

  it("sends a photo as an image part", async () => {
    const { svc, complete } = build({ responses: [TWO] });
    await svc.extract({
      file: {
        buffer: Buffer.from("jpg"),
        mimetype: "image/jpeg",
        originalname: "card.jpg",
        size: 3
      },
      language: "fr"
    });
    const user = complete.mock.calls[0][0].user;
    expect(Array.isArray(user)).toBe(true);
    expect(user[1]).toEqual({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${Buffer.from("jpg").toString("base64")}`,
        detail: "high"
      }
    });
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
        buffer: Buffer.from("jpg"),
        mimetype: "image/jpeg",
        originalname: "card.jpg",
        size: 3
      },
      language: "fr"
    });
    expect(ocr.ocr).toHaveBeenCalled();
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
          buffer: Buffer.from("jpg"),
          mimetype: "image/jpeg",
          originalname: "c.jpg",
          size: 3
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
