import { z } from "zod";

// Basic primitive types
export const Uuid = z.string().uuid();

// JSON Schema types for input/output
export type JsonSchemaType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array";

export interface JsonSchemaProperty {
  type: JsonSchemaType;
  format?: string;
  title?: string;
  description?: string;
  importance?: "high" | "medium" | "low";
  extractionInstructions?: string;
  displayName?: string;
  examples?: Array<{ id: string; input: string; output: string }>;
  order?: number;
  // Array-specific
  items?: {
    type: JsonSchemaType;
    format?: string;
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  // Object-specific
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface JsonSchemaDefinition {
  $schema?: string;
  type: "object";
  title?: string;
  description?: string;
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

// Schema Property type for UI
export type TSchemaProperty = {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "list";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  required: boolean;
  itemType?: "string" | "number" | "boolean" | "date" | "object";
  fields?: TSchemaProperty[];
  extractionInstructions?: string;
  importance?: "high" | "medium" | "low";
  examples?: Array<{ id: string; input: string; output: string }>;
};
