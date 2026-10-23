import type { z, ZodTypeAny } from "zod";

/** The model answered, but not with something the feature can use. Reported as a 502, not a 500. */
export class ModelOutputError extends Error {
  constructor(
    message: string,
    /** The first 500 characters of what came back, for the log. */
    readonly sample: string
  ) {
    super(message);
    this.name = "ModelOutputError";
  }
}

/**
 * JSON-mode output into a validated object.
 *
 * JSON mode guarantees syntactically valid JSON, but a model still fences it in ```json now and
 * then, and nothing guarantees the SHAPE. So: unfence, parse, validate. The caller decides whether
 * a failure is worth one retry.
 */
export function parseModelJson<S extends ZodTypeAny>(
  raw: string,
  schema: S
): z.infer<S> {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ModelOutputError(
      "The assistant returned something that is not JSON",
      raw.slice(0, 500)
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ModelOutputError(
      `The assistant's answer had the wrong shape: ${result.error.issues
        .slice(0, 3)
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ")}`,
      raw.slice(0, 500)
    );
  }
  return result.data;
}

export const LANGUAGE_NAMES: Record<"fr" | "nl", string> = {
  fr: "French",
  nl: "Dutch"
};
