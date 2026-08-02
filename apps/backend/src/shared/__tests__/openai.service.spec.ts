import {
  BULK_TIER,
  MODELS,
  REASONING_ALLOWANCE,
  type ModelTier
} from "@packages/types";
import {
  ALLOWED_REQUEST_FIELDS,
  OpenAiService,
  requestFields,
  StreamIncompleteError
} from "../openai.service";

/**
 * The REQUEST SHAPE, asserted against the real builder.
 *
 * This file exists because 612 tests were green while production 400'd on every background run:
 * "Unsupported parameter: 'max_tokens' is not supported with this model." Nothing executed
 * `complete()` — measured coverage of openai.service.ts was 0% functions — so the registry had a
 * capability field and no enforced consumer, and the test named "records that no current model
 * accepts a temperature" would equally have passed with `temperature: 0` back in the request.
 *
 * So the assertions here are deliberately about what is EMITTED, not about what the registry says.
 * The load-bearing pair is `names the token ceiling…` and `follows a mutated registry…`: one pins
 * the default, the other pins that the value is READ rather than written twice. Mutation-checked —
 * hardcoding `max_tokens` fails the first, re-adding `temperature: 0` fails the allow-list test,
 * and dropping the reasoning allowance fails the budget test.
 */

/** Minimal stand-in for the SDK client. `complete()` only reaches `chat.completions.create`. */
function serviceWithStub(response: unknown): {
  service: OpenAiService;
  create: jest.Mock;
} {
  const create = jest.fn().mockResolvedValue(response);
  const service = new OpenAiService(
    {} as never, // ConfigService — never reached: the client is injected below.
    {} as never // SecretsService
  );
  // getClient() returns the cached client when one is set, so this bypasses key resolution
  // entirely. Assigning the private field is the seam; no production code changes for the test.
  (service as unknown as { client: unknown }).client = {
    chat: { completions: { create } }
  };
  return { service, create };
}

const OK = {
  choices: [{ finish_reason: "stop", message: { content: "{}" } }],
  usage: { completion_tokens_details: { reasoning_tokens: 12 } }
};

/** Swaps one registry entry for the duration of `fn`, restoring it even if the body throws. */
function withModel(
  tier: ModelTier,
  patch: Partial<(typeof MODELS)[ModelTier]>,
  fn: () => Promise<void>
): Promise<void> {
  const saved = MODELS[tier];
  MODELS[tier] = { ...saved, ...patch };
  return fn().finally(() => {
    MODELS[tier] = saved;
  });
}

describe("the chat-completion request builder", () => {
  it("names the token ceiling whatever the chosen model calls it", async () => {
    const { service, create } = serviceWithStub(OK);
    await service.complete({ user: "hi", maxTokens: 1200 });

    const body = create.mock.calls[0][0];
    expect(body).toHaveProperty("max_completion_tokens");
    // Asserting only that the right key is PRESENT would still pass if both were sent, and it is
    // the presence of the rejected one that produces the 400.
    expect(Object.keys(body)).not.toContain("max_tokens");
  });

  // THE test. A literal cannot follow a mutated registry; only a capability read can.
  it("follows a mutated registry rather than a literal", async () => {
    await withModel("deep", { maxTokensParam: "max_tokens" }, async () => {
      const { service, create } = serviceWithStub(OK);
      await service.complete({ user: "hi", maxTokens: 1200 });

      const body = create.mock.calls[0][0];
      expect(body).toHaveProperty("max_tokens");
      expect(Object.keys(body)).not.toContain("max_completion_tokens");
    });
  });

  it("sends nothing outside the allow-list", async () => {
    // Catches the temperature class: re-adding `temperature: 0` here fails this test, which the
    // registry's own "no model accepts a temperature" assertion never could.
    const { service, create } = serviceWithStub(OK);
    await service.complete({ user: "hi", json: true, maxTokens: 100 });

    for (const key of Object.keys(create.mock.calls[0][0]))
      expect(ALLOWED_REQUEST_FIELDS.has(key)).toBe(true);
    expect(Object.keys(create.mock.calls[0][0])).not.toContain("temperature");
  });

  it("pays for the model's reasoning on top of the prose the caller asked for", async () => {
    const { service, create } = serviceWithStub(OK);
    await service.complete({ user: "hi", maxTokens: 1200 });

    // Sending the bare 1200 is what made a hard prompt come back empty: the ceiling counts
    // reasoning tokens, and a hard prompt spends the whole budget before writing a word.
    expect(create.mock.calls[0][0].max_completion_tokens).toBe(
      1200 + REASONING_ALLOWANCE.medium
    );
  });

  it("sends no ceiling at all when the caller set no budget", async () => {
    const { service, create } = serviceWithStub(OK);
    await service.complete({ user: "hi" });

    const body = create.mock.calls[0][0];
    expect(Object.keys(body)).not.toContain("max_completion_tokens");
    expect(Object.keys(body)).not.toContain("max_tokens");
  });

  it("routes a mechanical pass to the bulk tier at the effort floor", async () => {
    const { service, create } = serviceWithStub(OK);
    await service.complete({ user: "hi", fast: true, depth: "thorough" });

    // `fast` wins over the depth: deliberation on "copy this quote" buys nothing, and this pass
    // runs hundreds of times per job.
    expect(create.mock.calls[0][0].model).toBe(MODELS[BULK_TIER].id);
    expect(create.mock.calls[0][0].reasoning_effort).toBe("low");
  });

  it("raises the tier and the effort together when the caller asks to go deep", async () => {
    const { service, create } = serviceWithStub(OK);
    await service.complete({ user: "hi", depth: "thorough" });

    expect(create.mock.calls[0][0].model).toBe(MODELS.deep.id);
    expect(create.mock.calls[0][0].reasoning_effort).toBe("high");
  });

  it("omits reasoning_effort for a model that does not accept one", async () => {
    await withModel("deep", { supportsReasoningEffort: false }, async () => {
      const { service, create } = serviceWithStub(OK);
      await service.complete({ user: "hi" });
      expect(Object.keys(create.mock.calls[0][0])).not.toContain(
        "reasoning_effort"
      );
    });
  });

  it("builds the streaming request through the same builder", async () => {
    // The two paths used to build their own. That is how `max_tokens` survived on one of them.
    const create = jest.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "ok" }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: "stop" }] };
      }
    });
    const service = new OpenAiService({} as never, {} as never);
    (service as unknown as { client: unknown }).client = {
      chat: { completions: { create } }
    };

    const out: string[] = [];
    for await (const d of service.streamChat([{ role: "user", content: "x" }], {
      depth: "quick"
    }))
      out.push(d);

    const body = create.mock.calls[0][0];
    expect(out.join("")).toBe("ok");
    expect(body.model).toBe(MODELS.balanced.id);
    expect(body.reasoning_effort).toBe("low");
    for (const key of Object.keys(body))
      expect(ALLOWED_REQUEST_FIELDS.has(key)).toBe(true);
  });
});

describe("truncation", () => {
  it("throws rather than returning the empty string a truncated call produces", async () => {
    // Measured against the live API: a hard prompt at effort `high` with a 4000-token ceiling spent
    // all 4000 reasoning and returned content:"" with finish_reason:"length". Returning "" here is
    // how an artifact ends up with zero claims and nobody can say why.
    const { service } = serviceWithStub({
      choices: [{ finish_reason: "length", message: { content: "" } }],
      usage: { completion_tokens_details: { reasoning_tokens: 3500 } }
    });
    await expect(
      service.complete({ user: "hi", maxTokens: 1500 })
    ).rejects.toThrow(/truncated/i);
  });

  it("names the numbers needed to fix it", async () => {
    const { service } = serviceWithStub({
      choices: [{ finish_reason: "length", message: { content: "" } }],
      usage: { completion_tokens_details: { reasoning_tokens: 3500 } }
    });
    const err = await service
      .complete({ user: "hi", maxTokens: 1500 })
      .catch((e: Error) => e);

    // A truncation you cannot diagnose from the log is a truncation you will hit again.
    expect(String(err)).toContain(MODELS.deep.id);
    expect(String(err)).toContain("3500");
  });

  it("returns the content of a completion that finished normally", async () => {
    const { service } = serviceWithStub({
      choices: [{ finish_reason: "stop", message: { content: "the answer" } }]
    });
    await expect(service.complete({ user: "hi" })).resolves.toBe("the answer");
  });
});

describe("requestFields", () => {
  it("is the single place either path gets its fields from", () => {
    // Exercised directly as well as through the service, because a future third caller (a rerank,
    // a tool-use path) must have somewhere obvious to go.
    const fields = requestFields(MODELS.fast, "low", 500);
    expect(fields).toEqual({
      model: MODELS.fast.id,
      reasoning_effort: "low",
      max_completion_tokens: 500
    });
  });
});

/** A service whose stream yields `deltas`, then a terminal chunk carrying `finish`. */
function serviceWithStream(
  deltas: string[],
  finish: string | null
): OpenAiService {
  const create = jest.fn().mockResolvedValue({
    async *[Symbol.asyncIterator]() {
      for (const d of deltas)
        yield { choices: [{ delta: { content: d }, finish_reason: null }] };
      yield { choices: [{ delta: {}, finish_reason: finish }] };
    }
  });
  const service = new OpenAiService({} as never, {} as never);
  (service as unknown as { client: unknown }).client = {
    chat: { completions: { create } }
  };
  return service;
}

async function drain(service: OpenAiService): Promise<{
  text: string;
  error: unknown;
}> {
  let text = "";
  try {
    for await (const d of service.streamChat([{ role: "user", content: "x" }]))
      text += d;
    return { text, error: null };
  } catch (error) {
    return { text, error };
  }
}

/**
 * The streaming path is the one a lawyer actually reads — the chat reply and the assessment a
 * filing gets argued from. It used to discard finish_reason entirely, so a stream that stopped
 * mid-sentence was persisted with status 'complete' and nothing anywhere said otherwise.
 */
describe("streamChat truncation", () => {
  it("yields everything that arrived BEFORE reporting the stream was cut short", async () => {
    // Order matters: the consumer keeps the fragment and stores it as visibly incomplete. Throwing
    // before yielding would discard a page of work the user watched appear on screen.
    const { text, error } = await drain(
      serviceWithStream(["Sur le rapport", " des donations"], "length")
    );
    expect(text).toBe("Sur le rapport des donations");
    expect(error).toBeInstanceOf(StreamIncompleteError);
    expect((error as StreamIncompleteError).reason).toBe("length");
  });

  it("reports a content filter, which a case file can trip on quoted material", async () => {
    const { error } = await drain(serviceWithStream(["par"], "content_filter"));
    expect((error as StreamIncompleteError).reason).toBe("content_filter");
  });

  it("reports a stream that carried no content at all", async () => {
    // Distinct from "the model had nothing to say": zero deltas means no answer was produced, and
    // persisting "" as a completed assessment is the silent failure this guards.
    const { text, error } = await drain(serviceWithStream([], "stop"));
    expect(text).toBe("");
    expect((error as StreamIncompleteError).reason).toBe("empty");
  });

  it("stays silent when the model finished normally", async () => {
    const { text, error } = await drain(serviceWithStream(["done"], "stop"));
    expect(text).toBe("done");
    expect(error).toBeNull();
  });

  it("carries how much arrived, so a caller can judge the fragment", async () => {
    const { error } = await drain(serviceWithStream(["abcde"], "length"));
    expect((error as StreamIncompleteError).produced).toBe(5);
  });
});
