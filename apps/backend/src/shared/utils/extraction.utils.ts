/**
 * Shared utilities for extraction services
 */

export interface MaterialExtractionResult {
  // Core extraction data (defined by job output schema)
  itemCode: string | null;
  itemName: string | null;
  technicalSpecifications?: string;
  executionNotes?: string;
  quantity?: number | null;
  unit?: string | null;
  additionalNotes?: string;
  confidenceScore?: number | null;
  pageNumber?: number | null;
  status?: "pending" | "accepted" | "rejected" | "edited";
  lastUpdatedBy?: string | null;
  lastUpdatedAt?: string;

  // Simple evidence fields (will be moved to evidence object by extraction-result.service)
  location?: string | null; // Simple location description like "Table 1, Row 3"
  sourceText?: string; // The actual text extracted from the document

  // System metadata (for tracking extraction method)
  extractionMethod?:
    | "vision-only"
    | "ocr-enhanced"
    | "hybrid"
    | "chain-of-thought"
    | "batch-ocr"
    | "dynamic-schema";

  // File tracking metadata
  sourceDataLayerId?: string;
  sourceFileName?: string;

  // Agent execution metadata (populated when agents process this result)
  agentExecutionMetadata?: any[];
}

/**
 * Parse German number formats to JavaScript numbers
 * Examples: "95.000" → 95000, "1.000,50" → 1000.5, "2,5" → 2.5
 */
export function parseGermanQuantity(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") return undefined;

  // Handle German number format
  let normalized = value.replace(/\s/g, ""); // Remove spaces

  // Check if it's a German format with comma as decimal separator
  if (normalized.includes(",") && normalized.includes(".")) {
    // Format like "1.000,50" - dot as thousand separator, comma as decimal
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",") && !normalized.includes(".")) {
    // Format like "95,000" or "2,5" - could be decimal or thousand separator
    const parts = normalized.split(",");
    if (parts[1] && parts[1].length > 3) {
      // Likely thousand separator (e.g., "95,000")
      normalized = normalized.replace(",", "");
    } else {
      // Likely decimal separator (e.g., "2,5")
      normalized = normalized.replace(",", ".");
    }
  } else if (normalized.includes(".") && !normalized.includes(",")) {
    // Format like "1.000" - thousand separator in German format
    const parts = normalized.split(".");
    if (parts[1] && parts[1].length === 3) {
      // Likely thousand separator
      normalized = normalized.replace(".", "");
    }
    // If not 3 digits after dot, treat as decimal (leave as is)
  }

  const parsed = parseFloat(normalized);
  if (isNaN(parsed)) return undefined;

  return parsed;
}

/**
 * Format price in German locale
 */
export function formatPrice(price: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(price);
}

/**
 * Format dimensions object to string
 */
export function formatDimensionsString(
  dimensions: Record<string, unknown>
): string | null {
  if (!dimensions) return null;

  const parts = [];
  if (dimensions.length) parts.push(`L: ${dimensions.length}`);
  if (dimensions.width) parts.push(`W: ${dimensions.width}`);
  if (dimensions.height) parts.push(`H: ${dimensions.height}`);
  if (dimensions.diameter) parts.push(`⌀: ${dimensions.diameter}`);
  if (dimensions.thickness) parts.push(`T: ${dimensions.thickness}`);
  if (dimensions.radius) parts.push(`R: ${dimensions.radius}`);

  const dimensionStr = parts.join(" × ");
  return dimensionStr + (dimensions.unit ? ` ${dimensions.unit}` : "");
}

/**
 * Build technical specifications from item data
 */
export function buildTechnicalSpecs(item: Record<string, unknown>): string {
  const specs = [];

  // Material type and market name
  if (item.materialType) specs.push(item.materialType as string);
  if (item.marketName) specs.push(item.marketName as string);

  // Color and grain
  if (item.color) specs.push(item.color as string);
  if (item.grain) specs.push(item.grain as string);

  // Standards
  if (item.standards) specs.push(item.standards as string);

  // Dimensions
  if (item.dimensions) {
    const dims = formatDimensionsString(
      item.dimensions as Record<string, unknown>
    );
    if (dims) specs.push(dims);
  }

  // Finish type
  if (item.finish) specs.push(item.finish as string);

  // Technical data
  if (item.technicalData) specs.push(item.technicalData as string);

  // Fallback to old format
  if (specs.length === 0 && item.materialDescription) {
    return item.materialDescription as string;
  }

  return specs.join(", ");
}

/**
 * Build additional notes from item data
 */
export function buildAdditionalNotes(item: Record<string, unknown>): string {
  const notes = [];

  if (item.surcharges) notes.push(`Surcharges: ${item.surcharges as string}`);
  if (item.variants) notes.push(`Variants: ${item.variants as string}`);
  if (item.accessories)
    notes.push(`Accessories: ${item.accessories as string}`);
  if (item.exceptions) notes.push(`Exceptions: ${item.exceptions as string}`);
  if (item.notes) notes.push(item.notes as string);
  if (item.category) notes.push(`Category: ${item.category as string}`);

  // Add pricing info if available
  if (item.unitPrice || item.totalPrice) {
    const priceInfo = [];
    if (item.unitPrice) {
      priceInfo.push(
        `Unit: ${formatPrice(item.unitPrice as number)} ${
          (item.currency as string) || "EUR"
        }`
      );
    }
    if (item.totalPrice) {
      priceInfo.push(
        `Total: ${formatPrice(item.totalPrice as number)} ${
          (item.currency as string) || "EUR"
        }`
      );
    }
    notes.push(priceInfo.join(", "));
  }

  return notes.join(" | ");
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("json") ||
    message.includes("truncated") ||
    message.includes("unterminated") ||
    message.includes("timeout") ||
    message.includes("rate limit")
  );
}

/**
 * Clean and repair JSON response from LLM
 * Handles truncated strings, incomplete JSON structures, and malformed responses
 */
export function cleanAndRepairJSON(response: string): string {
  if (!response || response.trim().length === 0) {
    throw new Error("Empty response");
  }

  // More aggressive cleaning of the response
  let cleanedResponse = response
    .replace(/```json\n?/g, "") // Remove ```json
    .replace(/```\n?/g, "") // Remove ```
    .replace(/`/g, "") // Remove any remaining backticks
    .replace(/^\s*[\r\n]+/gm, "") // Remove empty lines
    .trim();

  // Handle truncated JSON - try to complete it
  if (
    cleanedResponse &&
    !cleanedResponse.endsWith("}") &&
    !cleanedResponse.endsWith("]")
  ) {
    // Count open/close braces and brackets to determine what's needed
    const openBraces = (cleanedResponse.match(/\{/g) || []).length;
    const closeBraces = (cleanedResponse.match(/\}/g) || []).length;
    const openBrackets = (cleanedResponse.match(/\[/g) || []).length;
    const closeBrackets = (cleanedResponse.match(/\]/g) || []).length;

    // AGGRESSIVE: Check for unterminated strings at the end
    // A string is unterminated if there's an odd number of unescaped quotes at the end
    let trailingContent = cleanedResponse;
    
    // Remove trailing whitespace and common incomplete endings
    trailingContent = trailingContent.replace(/[\s,]*$/, "");
    
    // Find the last complete value boundary (}, ] or ")
    const lastCloseBrace = trailingContent.lastIndexOf("}");
    const lastCloseBracket = trailingContent.lastIndexOf("]");
    const lastCloseParen = trailingContent.lastIndexOf('"');
    
    const lastValueEnd = Math.max(lastCloseBrace, lastCloseBracket, lastCloseParen);
    
    // Check if we have an unterminated string by looking for an unclosed quote
    const afterLastStructure = cleanedResponse.substring(lastValueEnd + 1);
    const quoteCount = (afterLastStructure.match(/"/g) || []).length;
    
    if (quoteCount % 2 === 1) {
      // Odd number of quotes = unterminated string
      // Find the position of the last complete comma or closing brace
      const lastCommaIndex = cleanedResponse.lastIndexOf(",", lastValueEnd);
      const lastBraceIndex = cleanedResponse.lastIndexOf("}", lastValueEnd);
      
      if (lastCommaIndex > lastBraceIndex) {
        // Remove content after the last comma (incomplete field)
        cleanedResponse = cleanedResponse.substring(0, lastCommaIndex) + "}";
      } else if (lastBraceIndex >= 0) {
        // We're inside an object, just close it
        cleanedResponse = cleanedResponse.substring(0, lastBraceIndex + 1);
      }
    }

    // Recount after fixing unterminated strings
    const openBraces2 = (cleanedResponse.match(/\{/g) || []).length;
    const closeBraces2 = (cleanedResponse.match(/\}/g) || []).length;
    const openBrackets2 = (cleanedResponse.match(/\[/g) || []).length;
    const closeBrackets2 = (cleanedResponse.match(/\]/g) || []).length;

    // Close any remaining incomplete structures
    let closingChars = "";

    // Close open brackets first (arrays)
    for (let i = 0; i < openBrackets2 - closeBrackets2; i++) {
      closingChars += "]";
    }

    // Close open braces (objects)
    for (let i = 0; i < openBraces2 - closeBraces2; i++) {
      closingChars += "}";
    }

    if (closingChars) {
      cleanedResponse += closingChars;
    }
  }

  return cleanedResponse;
}
