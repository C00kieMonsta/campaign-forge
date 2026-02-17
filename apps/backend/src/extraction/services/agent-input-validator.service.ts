import { Injectable, Logger } from "@nestjs/common";
import { AgentInputValidationResult } from "@packages/types";

/**
 * Validates extraction results before sending to agents.
 * Ensures data quality and prevents agent errors from malformed input.
 */
@Injectable()
export class AgentInputValidatorService {
  private readonly logger = new Logger(AgentInputValidatorService.name);

  /**
   * Validates that data matches expected structure before agent processing
   * Separates valid from invalid results for detailed error tracking
   */
  validateResults(
    results: unknown[],
    schemaDefinition?: any
  ): AgentInputValidationResult {
    const validationErrors: Array<{
      index: number;
      error: string;
      data: unknown;
    }> = [];
    const valid: unknown[] = [];
    const invalid: unknown[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];

      try {
        // Check basic structure
        if (!this.isValidExtractionResult(result)) {
          throw new Error(
            `Invalid extraction result structure: ${typeof result}`
          );
        }

        // If schema is provided, validate against it
        if (schemaDefinition) {
          this.validateAgainstSchema(result, schemaDefinition);
        }

        // Result passed validation
        valid.push(result);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        invalid.push({
          ...(result instanceof Object && result !== null ? result : {}),
          _validationError: errorMessage,
          _skipAgents: true
        });

        validationErrors.push({
          index: i,
          error: errorMessage,
          data: result
        });
      }
    }

    return {
      valid,
      invalid,
      validCount: valid.length,
      invalidCount: invalid.length,
      validationErrors
    };
  }

  /**
   * Check if result has basic expected structure of extraction result
   */
  private isValidExtractionResult(result: unknown): boolean {
    // Must be an object
    if (typeof result !== "object" || result === null) {
      return false;
    }

    // Check if it's a plain object (not Date, Map, etc.)
    if (Object.prototype.toString.call(result) !== "[object Object]") {
      return false;
    }

    // Must have at least one property (not empty)
    if (Object.keys(result).length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Validates result against schema definition
   */
  private validateAgainstSchema(result: unknown, schema: any): void {
    if (!schema || !schema.properties) {
      // No detailed schema provided, basic validation already done
      return;
    }

    if (typeof result !== "object" || result === null) {
      throw new Error("Result must be an object");
    }

    const resultObj = result as Record<string, unknown>;

    // Check required fields if specified
    if (Array.isArray(schema.required)) {
      for (const requiredField of schema.required) {
        if (!(requiredField in resultObj)) {
          throw new Error(`Missing required field: ${requiredField}`);
        }
      }
    }

    // Validate field types if schema specifies them
    for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
      if (!(fieldSchema instanceof Object)) continue;
      if (!(fieldName in resultObj)) continue; // Optional fields

      const fieldDef = fieldSchema as Record<string, unknown>;
      const fieldValue = resultObj[fieldName];
      const expectedType = fieldDef.type as string;

      if (expectedType) {
        const actualType = this.getJsonType(fieldValue);

        // Allow null for optional fields
        if (fieldValue === null || fieldValue === undefined) {
          continue;
        }

        if (actualType !== expectedType) {
          throw new Error(
            `Field "${fieldName}" has wrong type: expected ${expectedType}, got ${actualType}`
          );
        }
      }
    }
  }

  /**
   * Get JSON type of a value
   */
  private getJsonType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }

  /**
   * Generates report on validation results
   */
  generateReport(result: AgentInputValidationResult): string {
    if (result.invalidCount === 0) {
      return `✅ All ${result.validCount} extraction results passed validation`;
    }

    const errorSummary = result.validationErrors
      .slice(0, 3)
      .map((e) => `• Result #${e.index}: ${e.error}`)
      .join("\n");

    return (
      `⚠️ Validation issues: ${result.validCount} valid, ${result.invalidCount} invalid\n` +
      `Sample errors:\n${errorSummary}`
    );
  }
}
