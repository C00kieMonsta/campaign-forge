import { z } from "zod";
import { JsonSchemaDefinition, JsonSchemaProperty } from "./types";

/**
 * Compiled schema artifacts that can be used for validation and extraction.
 * Contains all validated and processed schema representations for runtime use.
 */
export interface CompiledSchema {
  /** The compiled Zod schema for runtime validation */
  zod: z.ZodTypeAny;
  /** The original JSON Schema (validated and normalized) */
  jsonSchema: Record<string, unknown>;
  /** Clean schema for LLM (stripped of verbose metadata, includes instructions for context) */
  cleanSchema?: Record<string, unknown>;
  /** Output schema for LLM (minimal structure only - what LLM should output) */
  outputSchema?: Record<string, unknown>;
  /** Metadata for the Zod schema (includes original JSON Schema) */
  zodMeta: { jsonSchema: Record<string, unknown> };
  /** Custom prompt for extraction (optional) */
  prompt?: string | null;
  /** Examples for the extraction (optional) */
  examples?: Array<Record<string, string>> | null;
  /** Schema name */
  name?: string;
  /** Post-processing agents (optional) */
  agents?: AgentDefinitionCompiled[];
}

/**
 * Compiled representation of an agent with required fields.
 * Used after schema compilation and validation.
 */
export interface AgentDefinitionCompiled {
  name: string;
  prompt: string;
  order: number;
  enabled?: boolean;
  description?: string;
}

/**
 * Valid JSON Schema types supported by the schema compiler.
 * Maps to JSON Schema primitive types used in extraction schemas.
 */
export const VALID_SCHEMA_TYPES = {
  OBJECT: "object",
  STRING: "string",
  NUMBER: "number",
  INTEGER: "integer",
  BOOLEAN: "boolean",
  ARRAY: "array"
} as const;

export type ValidSchemaType =
  (typeof VALID_SCHEMA_TYPES)[keyof typeof VALID_SCHEMA_TYPES];

/**
 * JSON Schema meta-schema for validating author-provided schemas.
 * Ensures schemas conform to expected structure before processing.
 */
export const AUTHOR_SCHEMA_META_SCHEMA = {
  type: "object",
  required: ["type"],
  properties: {
    type: { enum: ["object"] },
    properties: { type: "object" }
  }
} as const;

/**
 * Type alias for JSON Schema (uses existing JsonSchemaDefinition)
 */
export type JsonSchema = JsonSchemaDefinition;

/**
 * Validation result from schema parsing.
 */
export interface ValidationResult<T> {
  success: true;
  data: T;
}

/**
 * Validation error result with formatted errors.
 */
export interface ValidationErrorResult {
  success: false;
  errors: Record<string, unknown>;
}

/**
 * Union of validation results.
 */
export type ValidationResultUnion<T> =
  | ValidationResult<T>
  | ValidationErrorResult;

/**
 * Agent example with input and output.
 */
export interface AgentExample {
  input: string;
  output: string | Record<string, unknown>;
}

/**
 * Property with extraction field guidance for prompts.
 * Used in LLM prompts with simplified example structure (no id field).
 */
export interface PropertyWithGuidance
  extends Omit<JsonSchemaProperty, "examples"> {
  examples?: AgentExample[];
}
