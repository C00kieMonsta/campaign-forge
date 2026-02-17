// src/dto/extraction-schemas.ts
import { z } from "zod";
import {
  AGENT_RESULT_STATUSES,
  AGENT_RESULT_STATUSES_VALUES,
  TASK_CRITICALITY,
  TASK_CRITICALITY_VALUES
} from "../constants";

// ---- PropertyExample (for schema creation)
export const PropertyExampleSchema = z.object({
  input: z.string(),
  output: z.string()
});
export type PropertyExample = z.infer<typeof PropertyExampleSchema>;

// ---- Property (for schema creation)
export const PropertySchema = z.object({
  name: z.string(),
  displayName: z.string(),
  dataType: z.enum(["text", "number", "yes-no", "date", "list"]),
  description: z.string(),
  extractionInstructions: z.string(),
  isRequired: z.boolean(),
  importance: z.enum(["high", "medium", "low"]),
  examples: z.array(PropertyExampleSchema)
});
export type Property = z.infer<typeof PropertySchema>;

// ---- AgentDefinition (for post-processing agents)
export const AgentDefinitionSchema = z.object({
  name: z.string().min(1).max(100),
  prompt: z.string().min(1).max(5000),
  order: z.number().int().positive(),
  enabled: z.boolean().default(true),
  description: z.string().max(500).optional(),
  criticality: z.enum(TASK_CRITICALITY_VALUES).default(TASK_CRITICALITY.LOW),
  // Error handling configuration
  timeoutMs: z.number().int().positive().default(120000).optional(),
  retryCount: z.number().int().min(0).max(3).default(0).optional(),
  skipOnValidationError: z.boolean().default(false).optional(),
  minSuccessRate: z.number().min(0).max(100).default(100).optional()
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

// ---- AgentExecutionMetadata (for tracking agent execution)
export interface AgentExecutionMetadata {
  agentName: string;
  agentOrder: number;
  agentPrompt: string;
  executedAt: string;
  durationMs: number;
  status: (typeof AGENT_RESULT_STATUSES)[keyof typeof AGENT_RESULT_STATUSES];
  error?: string;
}

// ---- ExtractionSchemaResponse (for use-extraction-schema.ts)
export const ExtractionSchemaResponseSchema = z.object({
  schema: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    properties: z
      .record(
        z.object({
          type: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
          importance: z.string().optional(),
          extractionInstructions: z.string().optional()
        })
      )
      .optional(),
    required: z.array(z.string()).optional()
  }),
  version: z.string(),
  type: z.string()
});
export type ExtractionSchemaResponse = z.infer<
  typeof ExtractionSchemaResponseSchema
>;

// ---- CreateSchemaRequest (for schema creation)
export const CreateSchemaRequestSchema = z.object({
  name: z.string(),
  version: z.number(),
  definition: z.record(z.unknown()),
  prompt: z.string().optional(),
  examples: z.array(z.unknown()).optional(),
  agents: z.array(AgentDefinitionSchema).max(10).optional()
});
export type CreateSchemaRequest = z.infer<typeof CreateSchemaRequestSchema>;

// ---- CreateSchemaParams (for use-create-schema.ts hook)
export const CreateSchemaParamsSchema = z.object({
  schemaName: z.string(),
  version: z.number(),
  generalInstructions: z.string(),
  properties: z.array(PropertySchema),
  agents: z.array(AgentDefinitionSchema).max(10).optional()
});
export type CreateSchemaParams = z.infer<typeof CreateSchemaParamsSchema>;

// ---- TestAgentRequest (for testing agent execution)
export const TestAgentRequestSchema = z.object({
  agent: AgentDefinitionSchema,
  inputData: z.record(z.unknown())
});
export type TestAgentRequest = z.infer<typeof TestAgentRequestSchema>;

// ---- TestAgentResponse (for agent test results)
export const TestAgentResponseSchema = z.object({
  output: z.unknown(),
  metadata: z.object({
    agentName: z.string(),
    agentOrder: z.number(),
    agentPrompt: z.string(),
    executedAt: z.string(),
    durationMs: z.number(),
    status: z.enum(["success", "failed", "timeout"]),
    error: z.string().optional()
  })
});
export type TestAgentResponse = z.infer<typeof TestAgentResponseSchema>;

// ---- UpdateSchemaRequest (for schema updates)
export const UpdateSchemaRequestSchema = z.object({
  name: z.string().optional(),
  definition: z.record(z.unknown()).optional(),
  prompt: z.string().optional(),
  examples: z.array(z.unknown()).optional(),
  agents: z.array(AgentDefinitionSchema).max(10).optional(),
  changeDescription: z.string().optional()
});
export type UpdateSchemaRequest = z.infer<typeof UpdateSchemaRequestSchema>;

// ---- Agent Input Validation (for pre-processing validation)
export interface AgentInputValidationError {
  index: number;
  error: string;
  data: unknown;
}

export interface AgentInputValidationResult {
  valid: unknown[];
  invalid: unknown[];
  validCount: number;
  invalidCount: number;
  validationErrors: AgentInputValidationError[];
}

// ---- Agent Execution Diagnostics (for pipeline analysis)
export interface AgentErrorDetail {
  resultIndex: number;
  error: string;
  status: "failed" | "timeout";
}

export interface AgentErrorSummary {
  agentName: string;
  agentOrder: number;
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  successRate: number;
  errors: AgentErrorDetail[];
}

export interface AgentPipelineDiagnostics {
  totalResults: number;
  totalAgents: number;
  successfulAgents: number;
  failedAgents: number;
  overallSuccessRate: number;
  agentErrors: AgentErrorSummary[];
  criticalIssues: string[];
  recommendations: string[];
}
