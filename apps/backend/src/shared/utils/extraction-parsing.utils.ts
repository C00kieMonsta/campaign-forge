/**
 * Shared parsing utilities for extraction services
 */

import { Logger } from "@nestjs/common";
import {
  buildAdditionalNotes,
  buildTechnicalSpecs,
  cleanAndRepairJSON,
  MaterialExtractionResult,
  parseGermanQuantity
} from "@/shared/utils/extraction.utils";

const logger = new Logger("ExtractionParsingUtils");

/**
 * Validates sourceText completeness - ensures all extracted field values
 * appear in the sourceText.
 *
 * @param item - The extracted item to validate
 * @param schema - The schema with field definitions
 * @returns Validation result with list of fields missing from sourceText
 */
function validateSourceTextCompleteness(
  item: Record<string, unknown>,
  schema?: any
): { isComplete: boolean; missingFields: string[] } {
  const missingFields: string[] = [];

  // Skip validation if no sourceText or no schema
  if (
    !item.sourceText ||
    typeof item.sourceText !== "string" ||
    !schema?.properties
  ) {
    return { isComplete: true, missingFields: [] };
  }

  const sourceText = String(item.sourceText).toLowerCase().trim();

  // Skip validation if sourceText is too short (likely incomplete)
  if (sourceText.length < 3) {
    return { isComplete: false, missingFields: ["sourceText too short"] };
  }

  // Check each field value against sourceText
  for (const [fieldName, fieldValue] of Object.entries(item)) {
    // Skip metadata fields and null/undefined/empty values
    if (
      fieldName === "sourceText" ||
      fieldName === "location" ||
      fieldName === "pageNumber" ||
      fieldName === "extractionMethod" ||
      fieldValue === null ||
      fieldValue === undefined ||
      fieldValue === ""
    ) {
      continue;
    }

    // Convert value to string for checking
    const valueStr = String(fieldValue).trim().toLowerCase();

    // Skip very short values (single chars, etc) as they might have false positives
    if (valueStr.length < 2) {
      continue;
    }

    // Check if value appears in sourceText
    // We're lenient here - just checking if the value substring appears
    if (!sourceText.includes(valueStr)) {
      // For numbers, also check without formatting
      const numericValue = valueStr.replace(/[,.\s]/g, "");
      const numericSourceText = sourceText.replace(/[,.\s]/g, "");

      if (!numericSourceText.includes(numericValue)) {
        missingFields.push(fieldName);
      }
    }
  }

  const isComplete = missingFields.length === 0;

  if (!isComplete) {
    logger.warn(
      `[extraction-parsing] Incomplete sourceText: fields [${missingFields.join(", ")}] not found in sourceText: "${String(item.sourceText).substring(0, 100)}..."`
    );
  }

  return { isComplete, missingFields };
}

/**
 * Parse extraction response dynamically based on the provided schema.
 * This parser works with ANY schema structure, not hardcoded field names.
 *
 * @param response - The LLM response (JSON string)
 * @param pageNumber - The page number being processed
 * @param schema - The schema definition with field mappings
 * @returns Array of extracted records with dynamic field names
 */
export function parseDynamicExtractionResponse(
  response: string,
  pageNumber: number,
  schema?: any
): Record<string, unknown>[] {
  logger.log(
    `[extraction-parsing] parseDynamicExtractionResponse - Processing page ${pageNumber}`
  );

  try {
    // Handle empty or null responses
    if (!response || response.trim().length === 0) {
      logger.warn(
        `[extraction-parsing] parseDynamicExtractionResponse - Empty response for page ${pageNumber}`
      );
      return [];
    }

    const cleanedResponse = cleanAndRepairJSON(response);
    logger.log(
      `[extraction-parsing] parseDynamicExtractionResponse - Cleaned response length: ${cleanedResponse.length}`
    );

    const parsed = JSON.parse(cleanedResponse);

    // Handle both array and structured object formats
    let items: Record<string, unknown>[] = [];

    if (Array.isArray(parsed)) {
      items = parsed;
      logger.log(
        `[extraction-parsing] parseDynamicExtractionResponse - Parsed array format with ${items.length} items`
      );
    } else if (parsed.materials && Array.isArray(parsed.materials)) {
      items = parsed.materials;
      logger.log(
        `[extraction-parsing] parseDynamicExtractionResponse - Parsed structured format with ${items.length} items`
      );
    } else if (parsed.items && Array.isArray(parsed.items)) {
      items = parsed.items;
      logger.log(
        `[extraction-parsing] parseDynamicExtractionResponse - Parsed items format with ${items.length} items`
      );
    } else {
      logger.warn(
        `[extraction-parsing] parseDynamicExtractionResponse - Unexpected format for page ${pageNumber}`
      );
      return [];
    }

    // If schema is provided, validate that required fields are present
    if (schema && schema.required && Array.isArray(schema.required)) {
      const requiredFields = schema.required;
      items = items.filter((item) => {
        const hasAllRequired = requiredFields.every(
          (field: string) => field in item && item[field] !== undefined
        );
        if (!hasAllRequired) {
          logger.warn(
            `[extraction-parsing] parseDynamicExtractionResponse - Item missing required fields: ${JSON.stringify(item)}`
          );
        }
        return hasAllRequired;
      });
    }

    // Validate sourceText completeness and add page number to each item
    const results = items.map((item) => {
      const validation = validateSourceTextCompleteness(item, schema);

      return {
        ...item,
        pageNumber,
        extractionMethod: "dynamic-schema" as const,
        // Add flag if sourceText is incomplete (optional - for debugging/UI)
        ...(validation.isComplete
          ? {}
          : {
              sourceTextIncomplete: true,
              missingFieldsInSourceText: validation.missingFields
            })
      };
    });

    logger.log(
      `[extraction-parsing] parseDynamicExtractionResponse - Successfully parsed ${results.length} items from page ${pageNumber}`
    );
    return results;
  } catch (error) {
    logger.error(
      `[extraction-parsing] parseDynamicExtractionResponse - Failed for page ${pageNumber}:`,
      {
        error: error instanceof Error ? error.message : String(error),
        responseLength: response ? response.length : 0,
        responsePreview: response
          ? response.substring(0, 300)
          : "null/undefined"
      }
    );

    return [];
  }
}

/**
 * Parse extraction response from LLM into structured materials
 * Falls back to dynamic parser when schema is provided
 */
export function parseExtractionResponse(
  response: string,
  pageNumber: number,
  schema?: any
): MaterialExtractionResult[] {
  // If schema is provided, use dynamic parser
  if (schema) {
    logger.log(
      `[extraction-parsing] parseExtractionResponse - Using dynamic parser with schema for page ${pageNumber}`
    );
    return parseDynamicExtractionResponse(
      response,
      pageNumber,
      schema
    ) as unknown as MaterialExtractionResult[];
  }

  // Otherwise, use the legacy hardcoded parser (for backward compatibility)
  logger.log(
    `[extraction-parsing] parseExtractionResponse - Processing page ${pageNumber}`
  );

  try {
    // Handle empty or null responses
    if (!response || response.trim().length === 0) {
      logger.warn(
        `[extraction-parsing] parseExtractionResponse - Empty response for page ${pageNumber}`
      );
      return [];
    }

    const cleanedResponse = cleanAndRepairJSON(response);
    logger.log(
      `[extraction-parsing] parseExtractionResponse - Cleaned response length: ${cleanedResponse.length}`
    );

    const parsed = JSON.parse(cleanedResponse);

    // Handle both old format (array) and new format (structured object)
    let materials: Record<string, unknown>[] = [];

    if (Array.isArray(parsed)) {
      // Old format - direct array of materials
      materials = parsed;
      logger.log(
        `[extraction-parsing] parseExtractionResponse - Parsed old format with ${materials.length} materials`
      );
    } else if (parsed.materials && Array.isArray(parsed.materials)) {
      // New structured format
      materials = parsed.materials;
      logger.log(
        `[extraction-parsing] parseExtractionResponse - Parsed new structured format with ${materials.length} materials`
      );

      // Log additional extracted information
      if (parsed.projectInfo) {
        logger.log(
          `[extraction-parsing] parseExtractionResponse - Project info: ${JSON.stringify(parsed.projectInfo)}`
        );
      }
      if (parsed.summary) {
        logger.log(
          `[extraction-parsing] parseExtractionResponse - Summary: ${JSON.stringify(parsed.summary)}`
        );
      }
    } else {
      logger.warn(
        `[extraction-parsing] parseExtractionResponse - Unexpected format for page ${pageNumber}: ${Object.keys(parsed)}`
      );
      return [];
    }

    const results = materials.map((item: Record<string, unknown>) => {
      const material: MaterialExtractionResult = {
        // Core extraction data (follows job output schema)
        itemCode:
          (item.itemCode as string) || (item.itemNumber as string) || "",
        itemName:
          (item.itemName as string) ||
          (item.materialName as string) ||
          "Unknown Material",
        technicalSpecifications:
          (item.technicalSpecifications as string) || buildTechnicalSpecs(item),
        executionNotes: (item.executionNotes as string) || "",
        quantity: parseGermanQuantity(item.quantity),
        unit: item.unit as string,
        additionalNotes:
          (item.additionalNotes as string) || buildAdditionalNotes(item),
        confidenceScore: Math.max(
          0,
          Math.min(1, (item.confidenceScore as number) || 0.5)
        ),
        pageNumber,

        // Simple evidence fields (will be separated by extraction-result.service)
        location:
          (item.location as string) ||
          (item.locationInDocument as string) ||
          `Page ${pageNumber}`,
        sourceText:
          (item.sourceText as string) || (item.originalSnippet as string),

        // System metadata
        extractionMethod: "vision-only"
      };

      return material;
    });

    logger.log(
      `[extraction-parsing] parseExtractionResponse - Successfully parsed ${results.length} materials from page ${pageNumber}`
    );
    return results;
  } catch (error) {
    logger.error(
      `[extraction-parsing] parseExtractionResponse - Failed for page ${pageNumber}:`,
      {
        error: error instanceof Error ? error.message : String(error),
        responseLength: response ? response.length : 0,
        responsePreview: response
          ? response.substring(0, 300)
          : "null/undefined"
      }
    );

    return [];
  }
}

/**
 * Parse OCR response from Mistral
 */
export function parseOCRResponse(
  response: string,
  pageNumber: number
): {
  fullText: string;
  sections: Array<{
    content: string;
    position?: { startLine?: number; endLine?: number };
  }>;
  tables: Array<{
    headers: string[];
    rows: string[][];
  }>;
  metadata: {
    documentType?: string;
    language?: string;
    confidence?: number;
  };
} {
  if (!response || typeof response !== "string") {
    logger.warn(
      `[extraction-parsing] parseOCRResponse - Invalid response for page ${pageNumber}: ${typeof response}`
    );
    return {
      fullText: "",
      sections: [],
      tables: [],
      metadata: { documentType: "unknown", confidence: 0.1 }
    };
  }

  // Clean the response by removing markdown code blocks
  let cleaned = response.trim();

  // Remove various markdown code block formats
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```\s*$/, "")
    .trim();

  // Try to find JSON within the response if it starts with non-JSON text
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
      logger.log(
        `[extraction-parsing] parseOCRResponse - Extracted JSON for page ${pageNumber}`
      );
    } else {
      logger.warn(
        `[extraction-parsing] parseOCRResponse - No JSON found for page ${pageNumber}, using raw text`
      );
      // Return raw text as fallback
      return {
        fullText: response,
        sections: [{ content: response }],
        tables: [],
        metadata: {
          documentType: "raw_text",
          confidence: 0.6
        }
      };
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseError) {
    const errorMsg =
      parseError instanceof Error ? parseError.message : String(parseError);
    logger.warn(
      `[extraction-parsing] parseOCRResponse - Failed to parse JSON for page ${pageNumber}: ${errorMsg}`
    );
    logger.warn(
      `[extraction-parsing] parseOCRResponse - Response preview: ${cleaned.substring(0, 200)}...`
    );

    // If JSON parsing fails completely, return the raw text in a structured format
    return {
      fullText: response,
      sections: [{ content: response }],
      tables: [],
      metadata: {
        documentType: "raw_text",
        confidence: 0.5
      }
    };
  }

  // Validate the parsed structure and provide defaults
  const result = {
    fullText: parsed.fullText || response,
    sections: Array.isArray(parsed.sections)
      ? parsed.sections
      : [{ content: parsed.fullText || response }],
    tables: Array.isArray(parsed.tables) ? parsed.tables : [],
    metadata: {
      documentType: parsed.metadata?.documentType || "construction_document",
      language: parsed.metadata?.language || "unknown",
      confidence:
        typeof parsed.metadata?.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.metadata.confidence))
          : 0.8
    }
  };

  logger.log(
    `[extraction-parsing] parseOCRResponse - Successfully parsed page ${pageNumber}: ${result.fullText.length} chars, ${result.sections.length} sections, ${result.tables.length} tables`
  );
  return result;
}
