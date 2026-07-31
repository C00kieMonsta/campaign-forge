import type { ZodError } from "zod";

/** Flattens a ZodError into a single human-readable message for a 400 response. */
export function formatZodError(error: ZodError): string {
  return error.errors.map((e) => e.message).join(", ");
}
