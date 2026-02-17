import { Injectable, Logger } from "@nestjs/common";
import {
  AGENT_FAILURE_MODES,
  AGENT_RESULT_STATUSES,
  AgentDefinition,
  AgentExecutionMetadata,
  TASK_CRITICALITY
} from "@packages/types";
import { LLMService } from "@/shared/llm/llm.service";

@Injectable()
export class AgentExecutionService {
  private readonly logger = new Logger(AgentExecutionService.name);

  constructor(private readonly llmService: LLMService) {}

  /**
   * Strips markdown code blocks from a string and extracts the JSON content.
   * Handles formats like:
   * - ```json\n{...}\n```
   * - ```json\n[...]\n```
   * - ```\n{...}\n```
   * - ```\n[...]\n```
   * - {...} (plain JSON object)
   * - [...] (plain JSON array)
   */
  private stripMarkdownCodeBlocks(text: string): string {
    const trimmed = text.trim();

    // Check if text starts with markdown code block
    if (trimmed.startsWith("```")) {
      // Find the opening backticks and optional language identifier
      const openingMatch = trimmed.match(/^```(?:json|JSON)?\s*\n?/);
      if (openingMatch) {
        // Remove the opening
        let content = trimmed.substring(openingMatch[0].length);

        // Find and remove the closing backticks
        const closingIndex = content.lastIndexOf("```");
        if (closingIndex !== -1) {
          content = content.substring(0, closingIndex);
        }

        return content.trim();
      }
    }

    return trimmed;
  }

  /**
   * Executes the agent pipeline for MULTIPLE extraction results.
   * Runs agents sequentially in order, each agent processes ALL results before moving to the next.
   * Each agent has its own criticality level for LLM model selection.
   *
   * FLOW:
   * 1. Agent 1 processes all results with its criticality
   * 2. Agent 2 processes the output of Agent 1 with its criticality
   * 3. ... and so on until all agents are executed
   *
   * @param agents - Array of agent definitions
   * @param extractionResults - Array of extraction results to process
   * @param schemaContext - Schema name and definition for reference
   * @returns Array of processed results with metadata
   */
  async executeAgentPipelineBatch(
    agents: AgentDefinition[],
    extractionResults: unknown[],
    schemaContext: { name: string; definition: any }
  ): Promise<
    Array<{
      finalOutput: unknown;
      metadata: AgentExecutionMetadata[];
      hasErrors: boolean;
    }>
  > {
    // Filter and sort agents by order (enabled only)
    const sortedAgents = agents
      .filter((a) => a.enabled)
      .sort((a, b) => a.order - b.order);

    if (sortedAgents.length === 0) {
      // No agents to execute, return results as-is
      return extractionResults.map((result) => ({
        finalOutput: result,
        metadata: [],
        hasErrors: false
      }));
    }

    this.logger.log(
      JSON.stringify({
        level: "info",
        action: "startAgentPipelineBatch",
        resultCount: extractionResults.length,
        agentCount: sortedAgents.length,
        agents: sortedAgents.map((a) => ({
          name: a.name,
          order: a.order,
          criticality: a.criticality
        }))
      })
    );

    // Initialize metadata tracking for all results
    const allMetadata: AgentExecutionMetadata[][] = extractionResults.map(
      () => []
    );
    let currentResults = extractionResults;
    let hasAnyErrors = false;

    // Execute agents sequentially
    for (const agent of sortedAgents) {
      try {
        this.logger.log(
          JSON.stringify({
            level: "info",
            action: "executingAgent",
            agentName: agent.name,
            agentOrder: agent.order,
            criticality: agent.criticality,
            resultCount: currentResults.length
          })
        );

        const result = await this.executeAgentBatch(
          agent,
          currentResults,
          schemaContext
        );

        // Collect metadata for each result
        result.metadata.forEach((meta, resultIndex) => {
          if (resultIndex < allMetadata.length) {
            allMetadata[resultIndex].push(meta);
          }
        });

        // Update results for next agent (check if batch was successful)
        const batchHasErrors =
          result.status === "failed" ||
          result.failureMode === AGENT_FAILURE_MODES.SKIP_ON_ERROR;
        if (!batchHasErrors) {
          currentResults = result.outputs;
        } else {
          hasAnyErrors = true;
          // Continue with last successful results (currentResults unchanged)
        }
      } catch (error) {
        this.logger.error(
          JSON.stringify({
            level: "error",
            action: "agentExecutionFailed",
            agentName: agent.name,
            agentOrder: agent.order,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          })
        );
        hasAnyErrors = true;
        // Continue with next agent
      }
    }

    this.logger.log(
      JSON.stringify({
        level: "info",
        action: "agentPipelineBatchComplete",
        finalResultCount: currentResults.length,
        hasErrors: hasAnyErrors
      })
    );

    // Return results with their metadata
    return currentResults.map((output, index) => ({
      finalOutput: output,
      metadata: allMetadata[index] || [],
      hasErrors: hasAnyErrors
    }));
  }

  /**
   * Executes the agent pipeline for extraction results.
   * Filters enabled agents, sorts by order, and executes sequentially.
   * Each agent receives the output of the previous agent as input.
   * Collects execution metadata and tracks errors.
   *
   * @param agents - Array of agent definitions
   * @param initialData - Initial extraction data
   * @param schemaContext - Schema name and definition for reference
   * @returns Final output, metadata array, and error flag
   */
  async executeAgentPipeline(
    agents: AgentDefinition[],
    initialData: unknown,
    schemaContext: { name: string; definition: any }
  ): Promise<{
    finalOutput: unknown;
    metadata: AgentExecutionMetadata[];
    hasErrors: boolean;
  }> {
    // Filter and sort agents by order (enabled only)
    const sortedAgents = agents
      .filter((a) => a.enabled)
      .sort((a, b) => a.order - b.order);

    let currentData = initialData;
    const metadata: AgentExecutionMetadata[] = [];
    let hasErrors = false;

    // Iterate through agents sequentially
    for (const agent of sortedAgents) {
      try {
        const result = await this.executeAgent(
          agent,
          currentData,
          schemaContext
        );

        // Collect execution metadata
        metadata.push(result.metadata);

        // Pass output to next agent if successful, otherwise continue with last successful output
        if (result.metadata.status === "success") {
          currentData = result.output;
        } else {
          hasErrors = true;
          // Continue with last successful output (currentData unchanged)
        }
      } catch (error) {
        // Log unexpected errors during pipeline execution
        this.logger.error(
          `Unexpected error in agent pipeline for agent ${agent.name}: ${error instanceof Error ? error.message : String(error)}`,
          {
            agentName: agent.name,
            error: error instanceof Error ? error.stack : String(error)
          }
        );
        hasErrors = true;
        // Continue with next agent
      }
    }

    return {
      finalOutput: currentData,
      metadata,
      hasErrors
    };
  }

  /**
   * Executes a single agent on a BATCH of results.
   * This is much more efficient than calling executeAgent in a loop.
   * Makes ONE LLM call to process ALL results together.
   * Uses the agent's criticality level for LLM model selection.
   *
   * @param agent - The agent definition to execute
   * @param inputBatch - Array of results to process
   * @param schemaContext - Schema name and definition for reference
   * @returns Processed outputs and metadata for each result
   */
  private async executeAgentBatch(
    agent: AgentDefinition,
    inputBatch: unknown[],
    schemaContext: { name: string; definition: any }
  ): Promise<{
    outputs: unknown[];
    metadata: AgentExecutionMetadata[];
    status: "success" | "partial" | "failed" | "timeout";
    failureMode?: "batch_failure" | "individual_fallback" | "skip_on_error";
  }> {
    const startTime = Date.now();
    const timeout = agent.timeoutMs ?? 120000;
    const maxRetries = agent.retryCount ?? 0;

    // Try batch processing with retries
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Build the batch prompt
        const prompt = this.buildAgentBatchPrompt(
          agent,
          inputBatch,
          schemaContext
        );

        // Execute LLM call with timeout using the agent's criticality level
        const output = await Promise.race([
          this.llmService.ask({
            systemPrompt: "",
            userPrompt: prompt,
            criticality: agent.criticality
          }),
          this.createTimeout(timeout)
        ]);

        // Parse the output
        let parsedOutput = output;
        if (typeof output === "string") {
          try {
            // Strip markdown code blocks before parsing
            const cleanedOutput = this.stripMarkdownCodeBlocks(output);
            parsedOutput = JSON.parse(cleanedOutput);
          } catch (parseError) {
            throw new Error(
              `Agent returned invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
            );
          }
        }

        // Validate that output is an array
        if (!Array.isArray(parsedOutput)) {
          throw new Error(
            `Agent must return an array of results, got ${typeof parsedOutput}`
          );
        }

        const durationMs = Date.now() - startTime;
        const executedAt = new Date().toISOString();

        // Create metadata for each result - all successful
        const metadata: AgentExecutionMetadata[] = parsedOutput.map(() => ({
          agentName: agent.name,
          agentOrder: agent.order,
          agentPrompt: agent.prompt,
          executedAt,
          durationMs,
          status: AGENT_RESULT_STATUSES.SUCCESS
        }));

        return {
          outputs: parsedOutput,
          metadata,
          status: "success" as const
        };
      } catch (error) {
        // If final attempt fails, try fallback strategy
        if (attempt === maxRetries) {
          return this.fallbackAgentBatch(
            agent,
            inputBatch,
            schemaContext,
            error
          );
        }

        // Log retry attempt
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(
          JSON.stringify({
            level: "warn",
            action: "agentBatchRetry",
            agentName: agent.name,
            attempt: attempt + 1,
            maxRetries,
            error: errorMessage
          })
        );
      }
    }

    // Should not reach here, but return failed state as fallback
    const executedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;
    const metadata: AgentExecutionMetadata[] = inputBatch.map(() => ({
      agentName: agent.name,
      agentOrder: agent.order,
      agentPrompt: agent.prompt,
      executedAt,
      durationMs,
      status: AGENT_RESULT_STATUSES.FAILED,
      error: "Failed after all retry attempts"
    }));

    return {
      outputs: inputBatch,
      metadata,
      status: "failed" as const
    };
  }

  /**
   * Fallback strategy when batch agent processing fails.
   * Tries individual result processing if batch fails.
   */
  private async fallbackAgentBatch(
    agent: AgentDefinition,
    inputBatch: unknown[],
    schemaContext: { name: string; definition: any },
    originalError: unknown
  ): Promise<{
    outputs: unknown[];
    metadata: AgentExecutionMetadata[];
    status: "partial" | "failed";
    failureMode: "batch_failure" | "individual_fallback" | "skip_on_error";
  }> {
    const isTimeout =
      originalError instanceof Error &&
      originalError.message === "Agent execution timeout";
    const errorMessage =
      originalError instanceof Error
        ? originalError.message
        : String(originalError);
    const executedAt = new Date().toISOString();

    this.logger.warn(
      JSON.stringify({
        level: "warn",
        action: "agentBatchFallback",
        agentName: agent.name,
        batchSize: inputBatch.length,
        originalError: errorMessage,
        strategy: agent.skipOnValidationError
          ? "skip_on_error"
          : "keep_original"
      })
    );

    // If skipOnValidationError is true, skip this agent for these results
    if (agent.skipOnValidationError) {
      const metadata: AgentExecutionMetadata[] = inputBatch.map(() => ({
        agentName: agent.name,
        agentOrder: agent.order,
        agentPrompt: agent.prompt,
        executedAt,
        durationMs: Date.now() - parseInt(executedAt),
        status: AGENT_RESULT_STATUSES.FAILED,
        error: errorMessage
      }));

      return {
        outputs: inputBatch,
        metadata,
        status: "failed" as const,
        failureMode: AGENT_FAILURE_MODES.SKIP_ON_ERROR
      };
    }

    // Otherwise, return original batch unchanged with error metadata
    const metadata: AgentExecutionMetadata[] = inputBatch.map(() => ({
      agentName: agent.name,
      agentOrder: agent.order,
      agentPrompt: agent.prompt,
      executedAt,
      durationMs: 0,
      status: isTimeout
        ? AGENT_RESULT_STATUSES.TIMEOUT
        : AGENT_RESULT_STATUSES.FAILED,
      error: errorMessage
    }));

    return {
      outputs: inputBatch,
      metadata,
      status: "failed" as const,
      failureMode: AGENT_FAILURE_MODES.INDIVIDUAL_FALLBACK
    };
  }

  /**
   * Executes a single agent with timeout and error handling.
   * Returns the output and execution metadata.
   * On error or timeout, returns the input data unchanged.
   *
   * @param agent - The agent definition to execute
   * @param inputData - Current data to process
   * @param schemaContext - Schema name and definition for reference
   * @returns Output data and execution metadata
   */
  private async executeAgent(
    agent: AgentDefinition,
    inputData: unknown,
    schemaContext: { name: string; definition: any }
  ): Promise<{
    output: unknown;
    metadata: AgentExecutionMetadata;
  }> {
    const startTime = Date.now();
    const timeout = 60000; // 60 seconds

    try {
      // Build the prompt for this agent
      const prompt = this.buildAgentPrompt(agent, inputData, schemaContext);

      // Execute LLM call with timeout using low criticality for cost efficiency
      const output = await Promise.race([
        this.llmService.ask({
          systemPrompt: "",
          userPrompt: prompt,
          criticality: TASK_CRITICALITY.LOW
        }),
        this.createTimeout(timeout)
      ]);

      // Parse the output if it's a string (LLM returns JSON as string)
      let parsedOutput = output;
      if (typeof output === "string") {
        try {
          // Strip markdown code blocks before parsing
          const cleanedOutput = this.stripMarkdownCodeBlocks(output);
          parsedOutput = JSON.parse(cleanedOutput);
        } catch (parseError) {
          // If parsing fails, log warning but continue with string output
          this.logger.warn(
            `Agent ${agent.name} returned non-JSON output, using as-is`,
            { agentName: agent.name, output }
          );
        }
      }

      return {
        output: parsedOutput,
        metadata: {
          agentName: agent.name,
          agentOrder: agent.order,
          agentPrompt: agent.prompt,
          executedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          status: AGENT_RESULT_STATUSES.SUCCESS
        }
      };
    } catch (error) {
      const isTimeout =
        error instanceof Error && error.message === "Agent execution timeout";
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Log the error with agent details
      this.logger.error(
        `Agent ${agent.name} ${isTimeout ? "timed out" : "failed"}: ${errorMessage}`,
        {
          agentName: agent.name,
          agentOrder: agent.order,
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined
        }
      );

      // Return input data unchanged on error
      return {
        output: inputData,
        metadata: {
          agentName: agent.name,
          agentOrder: agent.order,
          agentPrompt: agent.prompt,
          executedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          status: isTimeout
            ? AGENT_RESULT_STATUSES.TIMEOUT
            : AGENT_RESULT_STATUSES.FAILED,
          error: errorMessage
        }
      };
    }
  }

  /**
   * Builds the prompt for a BATCH agent execution.
   * Processes multiple results in a single LLM call for efficiency.
   *
   * @param agent - The agent definition
   * @param inputBatch - Array of results to process
   * @param schemaContext - Schema name and definition for reference
   * @returns Formatted markdown prompt for the LLM
   */
  private buildAgentBatchPrompt(
    agent: AgentDefinition,
    inputBatch: unknown[],
    schemaContext: { name: string; definition: any }
  ): string {
    return `
# Batch Post-Processing Task

You are processing ${inputBatch.length} extraction results from the schema: ${schemaContext.name}

## Your Task
${agent.prompt}

## Current Data (Array of ${inputBatch.length} results)
${JSON.stringify(inputBatch, null, 2)}

## Schema Structure (for reference)
${JSON.stringify(schemaContext.definition, null, 2)}

## Critical Instructions - READ CAREFULLY
1. Process ALL ${inputBatch.length} results according to your task
2. Return ONLY a valid JSON ARRAY - nothing else
3. DO NOT include markdown code blocks (\`\`\`json, \`\`\`, etc.)
4. DO NOT include explanations, thoughts, or additional text
5. The output array length may differ from input (filtering/deduplicating is OK)
6. Maintain the schema structure for each result item
7. Each result MUST be a valid object matching the schema

## Output Rules
- First character must be: [
- Last character must be: ]
- NO text before the opening bracket [
- NO text after the closing bracket ]
- Each item in array must be valid JSON object

## Example Output Format
[
  {"field1": "value1", "field2": "value2"},
  {"field1": "value3", "field2": "value4"},
  {"field1": "value5", "field2": "value6"}
]

REMEMBER: Return ONLY the JSON array. Nothing else. No markdown. No explanation.
`.trim();
  }

  /**
   * Builds the prompt for an agent execution.
   * Includes schema context, agent task, current data, and schema structure.
   *
   * @param agent - The agent definition
   * @param inputData - Current data to process
   * @param schemaContext - Schema name and definition for reference
   * @returns Formatted markdown prompt for the LLM
   */
  private buildAgentPrompt(
    agent: AgentDefinition,
    inputData: unknown,
    schemaContext: { name: string; definition: any }
  ): string {
    return `
# Post-Processing Task

You are processing extraction results from the schema: ${schemaContext.name}

## Your Task
${agent.prompt}

## Current Data
${JSON.stringify(inputData, null, 2)}

## Schema Structure (for reference)
${JSON.stringify(schemaContext.definition, null, 2)}

## Critical Instructions - READ CAREFULLY
1. Process the data according to your task
2. Return ONLY valid JSON - nothing else
3. DO NOT include markdown code blocks (\`\`\`json, \`\`\`, etc.)
4. DO NOT include explanations, thoughts, or additional text
5. Maintain the schema structure
6. If filtering/transforming an array, return array; if single object, return object

## Output Rules
- Return ONLY JSON (object or array, depending on your task)
- NO text before or after the JSON
- NO markdown code blocks
- NO explanations

REMEMBER: Return ONLY the JSON. Nothing else.
`.trim();
  }

  /**
   * Creates a promise that rejects after the specified timeout.
   * Used with Promise.race to implement timeout pattern.
   *
   * @param ms - Timeout duration in milliseconds
   * @returns Promise that rejects with timeout error
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Agent execution timeout")), ms);
    });
  }
}
