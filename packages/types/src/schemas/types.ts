/**
 * Schema-related types
 * These types are used for JSON Schema definitions and extraction schemas
 */

/**
 * Schema Property - represents a single extraction field in a schema definition
 */
export type SchemaProperty = {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "list";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  required: boolean;
  itemType?: "string" | "number" | "boolean" | "date" | "object";
  fields?: SchemaProperty[]; // Only used when itemType is "object"
  extractionInstructions?: string;
  importance?: "high" | "medium" | "low"; // Alias for priority
  examples?: Array<{ id: string; input: string; output: string }>;
};

/**
 * JSON Schema Property
 */
export interface JsonSchemaProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  format?: string; // For date types (e.g., "date")
  title?: string;
  description?: string;
  importance?: "high" | "medium" | "low";
  extractionInstructions?: string;
  displayName?: string;
  examples?: Array<{ id: string; input: string; output: string }>;
  enum?: Array<string | number | boolean>; // Enum values
  order?: number; // Display order for CSV/Excel export (0-based index)
  // Array-specific
  items?: {
    type: "string" | "number" | "boolean" | "object" | "array";
    format?: string; // For date arrays
    properties?: Record<string, JsonSchemaProperty>; // For object arrays
    required?: string[]; // For object arrays
  };
  // Object-specific
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * JSON Schema Definition
 */
export interface JsonSchemaDefinition {
  $schema?: string;
  type: "object";
  title?: string;
  description?: string;
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * Normalized extraction schema for client consumption
 */
export type NormalizedExtractionSchema = {
  id: string;
  organizationId: string;
  schemaIdentifier: string;
  name: string;
  version: number;
  definition: Record<string, unknown>;
  compiledJsonSchema: Record<string, unknown>;
  prompt: string | null;
  examples: Record<string, unknown>[] | null;
  agents?: unknown[];
  changeDescription: string | null;
  createdAt: string;
  updatedAt: Date;
};
