import { MAX_ASSISTANT_MESSAGES, type AssistantMessage } from "@packages/types";
import {
  clearCampaignAssistantSession,
  loadCampaignAssistantSession,
  saveCampaignAssistantSession,
  trimHistory
} from "../assistantSession";

const KEY = "campaign_assistant_session";

const draft = {
  name: "Newsletter",
  subject: "Hello",
  html: "<p>Hi</p>",
  targetGroupIds: [],
  imageSlots: []
};

describe("campaign assistant session", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns null when nothing was saved", () => {
    expect(loadCampaignAssistantSession()).toBeNull();
  });

  it("round-trips messages and the draft", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "A spring newsletter" },
      { role: "assistant", content: "Here it is" }
    ];
    saveCampaignAssistantSession({ messages, draft });
    expect(loadCampaignAssistantSession()).toEqual({ messages, draft });
  });

  it("stores a null draft as null", () => {
    saveCampaignAssistantSession({
      messages: [{ role: "user", content: "Hi" }],
      draft: null
    });
    expect(loadCampaignAssistantSession()?.draft).toBeNull();
  });

  it("writes a version field and ignores other versions", () => {
    saveCampaignAssistantSession({ messages: [], draft: null });
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? "{}").version).toBe(1);

    sessionStorage.setItem(
      KEY,
      JSON.stringify({ version: 2, messages: [], draft: null })
    );
    expect(loadCampaignAssistantSession()).toBeNull();
  });

  it("ignores a corrupt entry", () => {
    sessionStorage.setItem(KEY, "{not json");
    expect(loadCampaignAssistantSession()).toBeNull();

    sessionStorage.setItem(KEY, JSON.stringify({ version: 1, messages: "x" }));
    expect(loadCampaignAssistantSession()).toBeNull();
  });

  it("clears the entry", () => {
    saveCampaignAssistantSession({ messages: [], draft });
    clearCampaignAssistantSession();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(loadCampaignAssistantSession()).toBeNull();
  });

  it("survives a storage that throws", () => {
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() =>
      saveCampaignAssistantSession({ messages: [], draft })
    ).not.toThrow();
    setItem.mockRestore();
  });
});

describe("trimHistory", () => {
  const history = (n: number): AssistantMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`
    }));

  it("returns the same array when it fits", () => {
    const messages = history(3);
    expect(trimHistory(messages, 5)).toBe(messages);
  });

  it("keeps the most recent messages", () => {
    const trimmed = trimHistory(history(6), 4);
    expect(trimmed.map((m) => m.content)).toEqual(["m2", "m3", "m4", "m5"]);
  });

  it("defaults to the shared ceiling", () => {
    const trimmed = trimHistory(history(MAX_ASSISTANT_MESSAGES + 5));
    expect(trimmed).toHaveLength(MAX_ASSISTANT_MESSAGES);
    expect(trimmed[trimmed.length - 1].content).toBe(
      `m${MAX_ASSISTANT_MESSAGES + 4}`
    );
  });
});
