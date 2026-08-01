import {
  BULK_TIER,
  DEFAULT_DEPTH,
  DEFAULT_TIER,
  DEPTHS,
  modelFor,
  MODELS,
  requestParamsFor,
  type ModelTier,
  type ReasoningDepth
} from "../models";

const TIERS: ModelTier[] = ["fast", "balanced", "deep"];
const DEPTH_NAMES: ReasoningDepth[] = ["quick", "standard", "thorough"];

describe("the model registry", () => {
  it("defines every tier, with its own id", () => {
    const ids = TIERS.map((tier) => MODELS[tier].id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const tier of TIERS) expect(MODELS[tier].tier).toBe(tier);
  });

  it("orders the tiers by cost, which is what makes the names mean anything", () => {
    // A "fast" tier that cost more than "deep" would send every call site to the wrong model.
    expect(MODELS.fast.inputCostPerMTok).toBeLessThan(
      MODELS.balanced.inputCostPerMTok
    );
    expect(MODELS.balanced.inputCostPerMTok).toBeLessThan(
      MODELS.deep.inputCostPerMTok
    );
    expect(MODELS.fast.outputCostPerMTok).toBeLessThan(
      MODELS.deep.outputCostPerMTok
    );
  });

  // The field that earns the file. Switching to gpt-5.6 broke every completion in the app because
  // the reasoning models reject `temperature`, and four call sites pinned it to 0.
  it("records that no current model accepts a temperature", () => {
    for (const tier of TIERS)
      expect(MODELS[tier].supportsTemperature).toBe(false);
  });

  it("routes the bulk work to the cheapest tier", () => {
    expect(BULK_TIER).toBe("fast");
    expect(MODELS[BULK_TIER].inputCostPerMTok).toBe(
      Math.min(...TIERS.map((t) => MODELS[t].inputCostPerMTok))
    );
  });

  it("routes work a lawyer reads to the frontier tier", () => {
    expect(DEFAULT_TIER).toBe("deep");
    expect(MODELS[DEFAULT_TIER].inputCostPerMTok).toBe(
      Math.max(...TIERS.map((t) => MODELS[t].inputCostPerMTok))
    );
  });

  it("looks a model up by tier", () => {
    expect(modelFor("deep").id).toBe(MODELS.deep.id);
  });
});

describe("reasoning depth", () => {
  it("defines every depth and never gets cheaper as it deepens", () => {
    const order = { low: 0, medium: 1, high: 2 };
    const efforts = DEPTH_NAMES.map((d) => order[DEPTHS[d].effort]);
    expect(efforts).toEqual([...efforts].sort((a, b) => a - b));
    const costs = DEPTH_NAMES.map(
      (d) => MODELS[DEPTHS[d].tier].inputCostPerMTok
    );
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it("defaults to the middle, so a normal question costs neither extreme", () => {
    expect(DEFAULT_DEPTH).toBe("standard");
    expect(DEPTHS[DEFAULT_DEPTH].effort).toBe("medium");
  });

  it("builds request fields a caller can spread straight into a completion", () => {
    expect(requestParamsFor("thorough")).toEqual({
      model: MODELS.deep.id,
      reasoning_effort: "high"
    });
    expect(requestParamsFor("quick")).toEqual({
      model: MODELS.balanced.id,
      reasoning_effort: "low"
    });
  });

  // Capability-driven, not hardcoded: adding an older model is a registry entry, not a code change.
  it("omits reasoning_effort for a model that does not accept it", () => {
    const stub = {
      ...MODELS.deep,
      supportsReasoningEffort: false
    };
    const saved = MODELS.deep;
    (MODELS as Record<ModelTier, typeof stub>).deep = stub;
    try {
      expect(requestParamsFor("standard")).toEqual({ model: stub.id });
    } finally {
      (MODELS as Record<ModelTier, typeof saved>).deep = saved;
    }
  });

  it("never emits an effort the pinned SDK cannot type", () => {
    // The API accepts "none" and "max"; the installed openai SDK types low|medium|high. Emitting
    // one of the others would only fail at the call site, which is a bad place to find out.
    const allowed = new Set(["low", "medium", "high"]);
    for (const depth of DEPTH_NAMES)
      expect(allowed.has(DEPTHS[depth].effort)).toBe(true);
  });
});
