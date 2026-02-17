// LLM Provider and Model Configuration

// Provider priority order for fallback chain
export const LLM_PROVIDER_PRIORITY = ["gemini", "openai", "anthropic"] as const;

export type LLMProvider = (typeof LLM_PROVIDER_PRIORITY)[number];

// Task criticality levels
export const TASK_CRITICALITY = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low"
} as const;

export type TaskCriticality =
  (typeof TASK_CRITICALITY)[keyof typeof TASK_CRITICALITY];
export const TASK_CRITICALITY_VALUES = ["high", "medium", "low"] as const;

// Model mapping by provider and criticality
// Selects the appropriate model based on task importance
export const LLM_MODELS: Record<
  LLMProvider,
  Record<TaskCriticality, string>
> = {
  gemini: {
    high: "gemini-3-pro-preview",
    medium: "gemini-3-flash-preview",
    low: "gemini-2.5-flash"
  },
  openai: {
    high: "gpt-5.2",
    medium: "gpt-5-mini",
    low: "gpt-5-nano"
  },
  anthropic: {
    high: "claude-opus-4-5-20251101",
    medium: "claude-sonnet-4-5-20250929",
    low: "claude-haiku-4-5-20251001"
  }
} as const;
