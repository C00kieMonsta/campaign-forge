import { z } from "zod";

/**
 * Create environment configuration from a Zod schema
 * @param schema - The Zod schema for environment variables
 * @returns Validated environment configuration
 */
export function envFromSchema<T extends z.ZodRawShape>(schema: T) {
  const envSchema = z.object(schema).passthrough(); // Allow unrecognized keys
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Missing/invalid environment configuration:\n${issues}\n\nTip: check your .env / export commands.`
    );
  }

  return result.data as z.infer<typeof envSchema>;
}
