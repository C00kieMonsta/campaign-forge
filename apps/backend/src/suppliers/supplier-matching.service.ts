import { Injectable, Logger } from "@nestjs/common";
import { ExtractionResult, Supplier } from "@packages/types";
import { z } from "zod";
import { SupplierMatchesDatabaseService } from "@/shared/database/services/supplier-matches.database.service";
import { SuppliersDatabaseService } from "@/shared/database/services/suppliers.database.service";
import { LLMService } from "@/shared/llm/llm.service";

// Wrapped in object for OpenAI compatibility (requires root type: "object")
const SupplierMatchLLMResponseSchema = z.object({
  results: z.array(
    z.object({
      extractionResultId: z.string(),
      matches: z.array(
        z.object({
          supplierId: z.number(),
          confidenceScore: z.number(),
          matchReason: z.string()
        })
      )
    })
  )
});

type SupplierMatchLLMResponse = z.infer<typeof SupplierMatchLLMResponseSchema>;

interface SupplierMatchResult {
  extractionResultId: string;
  matches: Array<{
    supplierId: string;
    confidenceScore: number;
    matchReason: string;
  }>;
}

@Injectable()
export class SupplierMatchingService {
  private readonly logger = new Logger(SupplierMatchingService.name);

  constructor(
    private readonly llmService: LLMService,
    private readonly suppliersDb: SuppliersDatabaseService,
    private readonly supplierMatchesDb: SupplierMatchesDatabaseService
  ) {}

  /**
   * Matches extraction results with suppliers using batch processing.
   * Reuses the hybrid batching pattern from AgentExecutionService for optimal performance.
   *
   * @param extractionJobId - The extraction job ID
   * @param organizationId - The organization ID
   * @returns Match statistics
   */
  async matchExtractionResultsWithSuppliers(
    extractionJobId: string,
    organizationId: string
  ): Promise<{
    jobId: string;
    status: "processing" | "completed" | "failed";
    totalResults: number;
    matchedResults: number;
  }> {
    try {
      const extractionResults =
        await this.supplierMatchesDb.getApprovedResultsByJobId(extractionJobId);

      if (extractionResults.length === 0) {
        this.logger.warn(
          `No approved extraction results found for job ${extractionJobId}`
        );
        return {
          jobId: extractionJobId,
          status: "completed",
          totalResults: 0,
          matchedResults: 0
        };
      }

      const suppliers =
        await this.suppliersDb.getSuppliersByOrganization(organizationId);

      if (suppliers.length === 0) {
        this.logger.warn(
          `No suppliers found for organization ${organizationId}`
        );
        return {
          jobId: extractionJobId,
          status: "completed",
          totalResults: extractionResults.length,
          matchedResults: 0
        };
      }

      this.logger.log(
        `Processing ${extractionResults.length} results with ${suppliers.length} suppliers`
      );

      const matchResults = await this.batchMatchWithLLM(
        extractionResults,
        suppliers
      );

      let matchedCount = 0;

      for (const matchResult of matchResults) {
        if (matchResult.matches.length > 0) {
          await this.supplierMatchesDb.createMatches(
            matchResult.extractionResultId,
            matchResult.matches
          );
          matchedCount++;
        }
      }

      this.logger.log(
        `Completed supplier matching: ${matchedCount}/${extractionResults.length} results matched`
      );

      return {
        jobId: extractionJobId,
        status: "completed",
        totalResults: extractionResults.length,
        matchedResults: matchedCount
      };
    } catch (error) {
      this.logger.error(
        `Failed to match suppliers for job ${extractionJobId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );

      return {
        jobId: extractionJobId,
        status: "failed",
        totalResults: 0,
        matchedResults: 0
      };
    }
  }

  /**
   * Batch matches extraction results with suppliers using LLM.
   * Processes results in chunks of 15 for maximum reliability.
   * Uses optimized context to stay within token limits.
   *
   * @param extractionResults - Array of extraction results to match
   * @param suppliers - Array of available suppliers
   * @returns Array of match results
   */
  private async batchMatchWithLLM(
    extractionResults: ExtractionResult[],
    suppliers: Supplier[]
  ): Promise<SupplierMatchResult[]> {
    const CHUNK_SIZE = 15;
    const chunks = this.chunkArray(extractionResults, CHUNK_SIZE);
    const supplierLookup = Object.fromEntries(
      suppliers.map((s, idx) => [idx + 1, s.id])
    );
    const allMatchResults: SupplierMatchResult[] = [];

    this.logger.log(
      `Processing ${extractionResults.length} results in ${chunks.length} chunks of ${CHUNK_SIZE}`
    );

    // Debug: log supplier lookup and sample supplier data
    this.logger.debug(
      JSON.stringify({
        action: "supplierLookupDebug",
        supplierLookup,
        sampleSupplier: suppliers[0]
          ? {
              id: suppliers[0].id,
              name: suppliers[0].name,
              materialsOffered: suppliers[0].materialsOffered
            }
          : null
      })
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      this.logger.log(
        `Processing chunk ${i + 1}/${chunks.length} (${chunk.length} results)`
      );

      try {
        const chunkResults = await this.processMatchingBatch(
          chunk,
          suppliers,
          supplierLookup
        );
        allMatchResults.push(...chunkResults);
      } catch (error) {
        this.logger.error(
          `Failed to process chunk ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined
        );
      }
    }

    return allMatchResults;
  }

  /**
   * Processes a single batch of extraction results with suppliers using LLM.
   *
   * @param resultChunk - Chunk of extraction results
   * @param suppliers - Array of available suppliers
   * @returns Array of match results for this chunk
   */
  private async processMatchingBatch(
    resultChunk: ExtractionResult[],
    suppliers: Supplier[],
    supplierLookup: Record<number, string>
  ): Promise<SupplierMatchResult[]> {
    const startTime = Date.now();
    const timeout = 180000;

    try {
      const prompt = this.buildMatchingPrompt(
        resultChunk,
        suppliers,
        supplierLookup
      );

      // Debug: log a sample of what the LLM receives
      const sampleResult = resultChunk[0];
      const sampleData = this.getResultData(sampleResult);
      const sampleFields = this.extractMatchingFields(sampleData);
      this.logger.debug(
        JSON.stringify({
          action: "matchingPromptDebug",
          sampleExtractionResultId: sampleResult.id,
          sampleFields,
          sampleFieldCount: Object.keys(sampleFields).length,
          rawExtractionKeys: sampleResult.rawExtraction
            ? Object.keys(sampleResult.rawExtraction)
            : [],
          verifiedDataKeys: sampleResult.verifiedData
            ? Object.keys(sampleResult.verifiedData as Record<string, any>)
            : [],
          supplierCount: suppliers.length,
          promptLength: prompt.length
        })
      );

      const output = await Promise.race([
        this.llmService.ask({
          systemPrompt: "",
          userPrompt: prompt,
          schema: SupplierMatchLLMResponseSchema,
          criticality: "high",
          maxOutputTokens: 8192
        }),
        this.createTimeout(timeout)
      ]);

      // Unwrap the response - schema returns { results: [...] }
      let matchResults: SupplierMatchLLMResponse["results"];

      if (typeof output === "string") {
        let cleanedOutput = "";
        try {
          cleanedOutput = this.stripMarkdownCodeBlocks(output);
          const parsed = JSON.parse(cleanedOutput);
          matchResults = parsed.results ?? parsed;
        } catch (parseError) {
          this.logger.error(
            `Failed to parse LLM response. Raw output (first 500 chars): ${output.substring(0, 500)}`
          );
          const partialResults = this.attemptPartialJsonRecovery(cleanedOutput || output);
          if (partialResults && partialResults.length > 0) {
            this.logger.warn(
              `Recovered ${partialResults.length} partial results from truncated response`
            );
            matchResults = partialResults;
          } else {
            throw new Error(
              `LLM returned invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
            );
          }
        }
      } else if (typeof output === "object" && output !== null) {
        // Typed response from schema validation
        const typed = output as SupplierMatchLLMResponse;
        matchResults = typed.results;
      } else {
        throw new Error("LLM returned unexpected output type");
      }

      if (!Array.isArray(matchResults)) {
        throw new Error("LLM must return an array of match results");
      }

      // Debug logging
      const rawMatchCount = matchResults.reduce(
        (sum, item) => sum + (item.matches?.length ?? 0),
        0
      );
      this.logger.log(
        `LLM returned ${matchResults.length} results with ${rawMatchCount} total raw matches`
      );
      if (matchResults.length > 0) {
        const preview = matchResults.slice(0, 3).map((item) => ({
          id: item.extractionResultId,
          matchCount: item.matches?.length ?? 0,
          matches: item.matches?.slice(0, 2)
        }));
        this.logger.log(`LLM output preview: ${JSON.stringify(preview)}`);
      }

      // Map supplier keys (numbers) to actual supplier UUIDs
      const results: SupplierMatchResult[] = matchResults.map((item) => ({
        extractionResultId: item.extractionResultId,
        matches: (item.matches ?? [])
          .map((match) => ({
            supplierId: supplierLookup[Number(match.supplierId)],
            confidenceScore: match.confidenceScore,
            matchReason: match.matchReason
          }))
          .filter((match) => match.supplierId != null)
      }));

      const durationMs = Date.now() - startTime;
      const totalMatches = results.reduce(
        (sum, r) => sum + r.matches.length,
        0
      );
      this.logger.log(
        `Batch matching completed in ${durationMs}ms for ${resultChunk.length} results (${totalMatches} matches found)`
      );

      return results;
    } catch (error) {
      const isTimeout =
        error instanceof Error && error.message === "Matching timeout";
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Batch matching ${isTimeout ? "timed out" : "failed"}: ${errorMessage}`,
        {
          batchSize: resultChunk.length,
          supplierCount: suppliers.length,
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined
        }
      );

      return resultChunk.map((result) => ({
        extractionResultId: result.id,
        matches: []
      }));
    }
  }

  /**
   * Builds the prompt for supplier matching.
   *
   * @param extractionResults - Array of extraction results
   * @param suppliers - Array of suppliers
   * @returns Formatted prompt for LLM
   */
  private buildMatchingPrompt(
    extractionResults: ExtractionResult[],
    suppliers: Supplier[],
    supplierLookup: Record<number, string>
  ): string {
    const suppliersByIndex = suppliers.map((s, idx) => ({
      key: idx + 1,
      name: s.name,
      materials: this.summarizeSupplierMaterials(s.materialsOffered)
    }));

    const prompt = `
# Supplier Matching Task

You are an expert procurement assistant matching construction material extraction results with suppliers.

## Your Goal
For each extraction result, identify the TOP 3 BEST suppliers who can provide the required materials.
Be selective - only match suppliers who can actually fulfill the requirements.

**Note**: Each result contains only essential fields (material, type, specs, quantity) to focus on core matching criteria.

## Extraction Results (${extractionResults.length} items)
Each result contains essential material information for matching:
${JSON.stringify(
  extractionResults.map((r) => ({
    id: r.id,
    ...this.extractMatchingFields(this.getResultData(r))
  })),
  null,
  2
)}

## Available Suppliers (${suppliers.length} suppliers)
Reference suppliers by their KEY, not their name.
Each supplier's materials are summarized for efficient matching:
${JSON.stringify(suppliersByIndex, null, 2)}

## Matching Criteria (in order of importance)
1. **Material Type Match**: Does the supplier offer this specific material type?
2. **Specifications**: Can the supplier meet the technical specifications (grade, size, finish, etc.)?
3. **Quantity Capability**: Can the supplier handle the required quantity?
4. **Quality Standards**: Does the supplier meet quality requirements?

## Confidence Score Guidelines
- **0.9-1.0**: Perfect match - supplier explicitly offers this exact material with matching specs
- **0.7-0.89**: Strong match - supplier offers this material type, specs likely compatible
- **0.5-0.69**: Moderate match - supplier offers similar materials, may need verification
- **Below 0.5**: Weak match - only use if no better options exist

## Output Format
Return a JSON object with a "results" array. Use supplier KEY (1, 2, 3, etc) not names:
{
  "results": [
    {
      "extractionResultId": "result-id-1",
      "matches": [
        {
          "supplierId": 1,
          "confidenceScore": 0.95,
          "matchReason": "Supplier offers Granite Border matching specs"
        }
      ]
    }
  ]
}

## Critical Rules
- Return top 3 best matches per result (or fewer if less than 3 good matches exist)
- If NO suppliers match, return empty matches array: []
- Match reasons should be concise (under 80 chars)
- Use supplier KEY (integer 1, 2, 3...) in supplierId field
- Every extraction result must appear in the results array

Begin matching now:
`.trim();

    return prompt;
  }

  /**
   * Returns the best available data from an extraction result.
   * Prefers verifiedData if it has content, otherwise falls back to rawExtraction.
   * An empty object {} is treated as "no data".
   */
  private getResultData(r: ExtractionResult): Record<string, any> {
    const verified = r.verifiedData as Record<string, any> | null;
    if (verified && typeof verified === "object" && Object.keys(verified).length > 0) {
      return verified;
    }
    return (r.rawExtraction as Record<string, any>) ?? {};
  }

  /**
   * Extracts a compact summary of extraction result data for matching.
   * Includes all non-empty fields, truncated to keep token usage low.
   */
  private static readonly EXCLUDED_FIELDS = new Set([
    "pageNumber",
    "sourceText",
    "sourceFileName",
    "snippetImageKey",
    "extractionMethod",
    "sourceDataLayerId",
    "sourceTextIncomplete",
    "agentExecutionMetadata",
    "missingFieldsInSourceText",
    "boundingBox"
  ]);

  private extractMatchingFields(
    data: Record<string, any>
  ): Record<string, string> {
    if (!data || typeof data !== "object") return {};

    const summary: Record<string, string> = {};

    for (const [key, value] of Object.entries(data)) {
      if (value == null || value === "") continue;
      if (SupplierMatchingService.EXCLUDED_FIELDS.has(key)) continue;

      const strValue =
        typeof value === "object" ? JSON.stringify(value) : String(value);

      if (strValue.length === 0 || strValue === "null") continue;

      summary[key] =
        strValue.length > 150 ? strValue.substring(0, 150) + "..." : strValue;
    }

    return summary;
  }

  /**
   * Summarizes supplier materials into a compact string.
   * Reduces token usage for supplier data by ~70%.
   *
   * @param materialsOffered - Array of materials offered by supplier
   * @returns Compact semicolon-separated string, max 200 chars
   */
  private summarizeSupplierMaterials(materialsOffered: unknown): string {
    if (!materialsOffered) return "No materials specified";

    if (Array.isArray(materialsOffered)) {
      if (materialsOffered.length === 0) return "No materials specified";

      // Convert to strings and filter out empty values
      const materials = materialsOffered
        .map((m) => String(m).trim())
        .filter((m) => m.length > 0);

      if (materials.length === 0) return "No materials specified";

      // Join with semicolons and truncate if needed
      const joined = materials.join("; ");

      if (joined.length <= 200) {
        return joined;
      }

      // Truncate but try to keep complete items
      let truncated = "";
      for (const material of materials) {
        if (truncated.length + material.length + 2 > 195) {
          // +2 for "; "
          truncated += "...";
          break;
        }
        truncated += (truncated ? "; " : "") + material;
      }

      return truncated || joined.substring(0, 200) + "...";
    }

    // If not an array, convert to string and truncate
    const str = String(materialsOffered);
    return str.length > 200 ? str.substring(0, 200) + "..." : str;
  }

  /**
   * Strips markdown code blocks and extracts JSON from LLM response.
   * Handles various formats the LLM might return.
   */
  private stripMarkdownCodeBlocks(text: string): string {
    let cleaned = text.trim();

    // Remove markdown code blocks (``` or ```json)
    const codeBlockPattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
    const match = cleaned.match(codeBlockPattern);
    if (match) {
      cleaned = match[1].trim();
    }

    // Try to find JSON array or object in the text
    // Look for content between [ ] or { }
    const jsonArrayMatch = cleaned.match(/(\[[\s\S]*\])/);
    if (jsonArrayMatch) {
      return jsonArrayMatch[1];
    }

    const jsonObjectMatch = cleaned.match(/(\{[\s\S]*\})/);
    if (jsonObjectMatch) {
      return jsonObjectMatch[1];
    }

    return cleaned;
  }

  /**
   * Helper method to split an array into chunks.
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Attempts to recover partial results from truncated JSON.
   * Extracts complete result objects even if the JSON is cut off.
   *
   * @param truncatedJson - Incomplete JSON string
   * @returns Array of recovered result objects, or null if recovery fails
   */
  private attemptPartialJsonRecovery(
    truncatedJson: string
  ): SupplierMatchLLMResponse["results"] | null {
    try {
      // Look for complete result objects in the truncated JSON
      // Pattern: { "extractionResultId": "...", "matches": [...] }
      const resultPattern =
        /"extractionResultId":\s*"([^"]+)",\s*"matches":\s*(\[[^\]]*\])/g;

      const results: SupplierMatchLLMResponse["results"] = [];
      let match;

      while ((match = resultPattern.exec(truncatedJson)) !== null) {
        const extractionResultId = match[1];
        const matchesJson = match[2];

        try {
          const matches = JSON.parse(matchesJson);
          if (Array.isArray(matches)) {
            results.push({
              extractionResultId,
              matches
            });
          }
        } catch {
          // Skip this result if matches array is malformed
          continue;
        }
      }

      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }

  /**
   * Creates a promise that rejects after the specified timeout.
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Matching timeout")), ms);
    });
  }
}
