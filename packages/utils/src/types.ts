import { z } from "zod";
import { RESOURCE_STATUSES_VALUES } from "@packages/types";

// Basic primitive types
export const Uuid = z.string().uuid();

// Project status enum (only one needed from the old statuses)
export const ProjectStatus = z.enum(RESOURCE_STATUSES_VALUES);
export type TProjectStatus = z.infer<typeof ProjectStatus>;

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
