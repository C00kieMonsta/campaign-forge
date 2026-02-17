import {
  ASYNC_JOB_STATUSES_VALUES,
  EXTRACTION_JOB_TYPES_VALUES,
  RESOURCE_STATUSES_VALUES,
  VERIFICATION_STATUSES_VALUES
} from "@packages/types";
import { z } from "zod";

// Basic primitive types
export const Uuid = z.string().uuid();

// Enums derived from constants
export const ExtractionJobType = z.enum(EXTRACTION_JOB_TYPES_VALUES);
export type TExtractionJobType = z.infer<typeof ExtractionJobType>;

export const ExtractionResultStatus = z.enum(VERIFICATION_STATUSES_VALUES);
export type TExtractionResultStatus = z.infer<typeof ExtractionResultStatus>;

export const ProjectStatus = z.enum(RESOURCE_STATUSES_VALUES);
export type TProjectStatus = z.infer<typeof ProjectStatus>;

export const ExtractionJobStatus = z.enum(ASYNC_JOB_STATUSES_VALUES);
export type TExtractionJobStatus = z.infer<typeof ExtractionJobStatus>;

// Central DTO schemas - these are the authoritative definitions

/**
 * Schema-driven extraction job request - STRICT VERSION
 * No inline outputSchema allowed, must reference an ExtractionSchema
 */
export const StartExtractionJobRequestSchema = z
  .object({
    dataLayerId: Uuid.optional(), // For backward compatibility with single file
    dataLayerIds: z.array(Uuid).optional(), // For multiple files
    jobType: ExtractionJobType.default("material_extraction"),
    config: z.record(z.any()).optional(), // AI model settings, etc.
    schemaId: Uuid // REQUIRED: must reference an ExtractionSchema
  })
  .refine(
    (data) =>
      data.dataLayerId || (data.dataLayerIds && data.dataLayerIds.length > 0),
    {
      message:
        "Either dataLayerId or dataLayerIds (with at least one ID) must be provided",
      path: ["dataLayerId", "dataLayerIds"]
    }
  );
export type TStartExtractionJobRequest = z.infer<
  typeof StartExtractionJobRequestSchema
>;

/**
 * Extraction result with schema validation support
 * Stores structured extraction data and validation errors
 */
export const ExtractionResultSchema = z.object({
  id: Uuid,
  extractionJobId: Uuid,

  // Structured extraction data from LLM (already parsed JSON)
  rawExtraction: z.any(),

  // Validation errors (if any)
  validationErrors: z.any().nullable().optional(),

  // Evidence of where data came from
  evidence: z.record(z.any()).default({}),

  // Human-verified version (starts as copy of rawExtraction, can be edited)
  verifiedData: z.any().nullable().optional(),

  // Agent execution metadata tracking which agents processed this result
  agentExecutionMetadata: z.any().optional(),

  // Status and metadata
  status: ExtractionResultStatus.default("pending"),
  confidenceScore: z.number().nullable().optional(),
  pageNumber: z.number().int().nullable().optional()
});
export type TExtractionResult = z.infer<typeof ExtractionResultSchema>;

/**
 * Schema Property - represents a single extraction field in a schema definition
 * Used to build JSON Schema definitions for structured extraction
 */
export const SchemaPropertySchema: z.ZodType<TSchemaProperty> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    type: z.enum(["string", "number", "boolean", "date", "list"]),
    title: z.string(),
    description: z.string(),
    priority: z.enum(["high", "medium", "low"]),
    required: z.boolean(),
    // List support
    itemType: z
      .enum(["string", "number", "boolean", "date", "object"])
      .optional(),
    // Object list support (nested fields) - only used when itemType is "object"
    fields: z.array(z.lazy(() => SchemaPropertySchema)).optional(),
    // Enhanced schema fields for property-specific extraction guidance
    extractionInstructions: z.string().optional(),
    importance: z.enum(["high", "medium", "low"]).optional(),
    examples: z
      .array(
        z.object({
          id: z.string(),
          input: z.string(),
          output: z.string()
        })
      )
      .optional()
  })
);

export type TSchemaProperty = {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "list";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  required: boolean;
  itemType?: "string" | "number" | "boolean" | "date" | "object";
  fields?: TSchemaProperty[]; // Only used when itemType is "object"
  // Enhanced schema fields for property-specific extraction guidance
  extractionInstructions?: string;
  importance?: "high" | "medium" | "low"; // Alias for priority
  examples?: Array<{ id: string; input: string; output: string }>;
};

/**
 * JSON Schema types for input/output
 * These represent the actual JSON Schema format stored in the database
 */
export type JsonSchemaType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array";

export interface JsonSchemaProperty {
  type: JsonSchemaType;
  format?: string; // For date types (e.g., "date")
  title?: string;
  description?: string;
  importance?: "high" | "medium" | "low";
  extractionInstructions?: string;
  displayName?: string;
  examples?: Array<{ id: string; input: string; output: string }>;
  order?: number; // Display order for CSV/Excel export (0-based index)
  // Array-specific
  items?: {
    type: JsonSchemaType;
    format?: string; // For date arrays
    properties?: Record<string, JsonSchemaProperty>; // For object arrays
    required?: string[]; // For object arrays
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

/**
 * Extraction Schema definition - stores author-defined JSON schemas
 * Uses schemaIdentifier for permanent identity across versions
 */
export const ExtractionSchemaSchema = z.object({
  id: Uuid,
  organizationId: Uuid,
  schemaIdentifier: z.string(), // Permanent 12-char alphanumeric identifier
  name: z.string(), // Can be changed across versions
  version: z.number().int(),
  definition: z.any(), // Author's JSON Schema (built from SchemaProperty[])
  compiledJsonSchema: z.any(), // Compiled/validated JSON Schema for LLM use
  prompt: z.string().nullable().optional(), // Custom extraction prompt
  examples: z.any().nullable().optional(), // Example extractions
  agents: z.any().optional(), // Post-processing agents for transforming extraction results
  changeDescription: z.string().nullable().optional(), // Description of changes in this version
  createdAt: z.date()
});
export type TExtractionSchema = z.infer<typeof ExtractionSchemaSchema>;

/**
 * Normalized extraction schema for client consumption
 * Ensures JSON fields are plain records/arrays and dates serialized to string
 */
export type NormalizedExtractionSchema = Omit<
  TExtractionSchema,
  "definition" | "compiledJsonSchema" | "examples" | "agents" | "createdAt"
> & {
  definition: Record<string, unknown>;
  compiledJsonSchema: Record<string, unknown>;
  examples: Record<string, unknown>[] | null;
  agents?: unknown[];
  createdAt: string;
};

/**
 * Extraction Job with strict schema reference
 */
export const ExtractionJobSchema = z.object({
  id: Uuid,
  organizationId: Uuid,
  initiatedBy: Uuid,
  jobType: ExtractionJobType,
  status: ExtractionJobStatus,
  progressPercentage: z.number().int().min(0).max(100),
  startedAt: z.date().nullable().optional(),
  completedAt: z.date().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  config: z.record(z.any()).default({}),

  // Schema reference (required)
  schemaId: Uuid,

  // Snapshotted compiled schema
  compiledJsonSchema: z.any().default({}),

  meta: z.record(z.any()).default({}),
  logs: z.array(z.any()).default([]),
  createdAt: z.date(),
  updatedAt: z.date()
});
export type TExtractionJob = z.infer<typeof ExtractionJobSchema>;
