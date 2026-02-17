/**
 * Generic prompt building utilities for schema-driven extraction
 */

/**
 * Build OCR system prompt (for Mistral OCR)
 */
export function buildOCRSystemPrompt(): string {
  return `You are an advanced OCR system specialized in document processing. 
Extract ALL text content from this document page with high accuracy.
Pay special attention to:
- Item codes and identifiers
- Names and descriptions
- Quantities and units
- Technical specifications
- Table structures
- Section headers

Return the extracted content in a structured format that preserves the document layout and context.`;
}

/**
 * Build OCR user prompt for specific page (for Mistral OCR)
 */
export function buildOCRUserPrompt(pageNumber: number): string {
  return `Extract all text content from this document page ${pageNumber}. 
Return a JSON structure with:
{
  "fullText": "complete text content preserving line breaks and structure",
  "sections": [
    {
      "content": "section text content",
      "position": {"startLine": 1, "endLine": 10}
    }
  ],
  "tables": [
    {
      "headers": ["Column 1", "Column 2"],
      "rows": [["Value 1", "Value 2"]]
    }
  ],
  "metadata": {
    "documentType": "document",
    "language": "en",
    "confidence": 0.95
  }
}

Focus on accuracy and preserve the original text exactly as it appears.`;
}

/**
 * Build Gemini system prompt for OCR processing with schema-driven extraction
 * Uses custom prompt if provided, otherwise falls back to generic prompt
 */
export function buildGeminiOCRSystemPrompt(
  customPrompt?: string | null,
  schemaName?: string
): string {
  if (customPrompt && customPrompt.trim()) {
    // Use custom schema prompt
    return `You are an expert extraction specialist for "${schemaName || "documents"}".
You will receive OCR-extracted text and must extract structured data according to the provided schema.

${customPrompt}

CRITICAL REQUIREMENTS:
- Return ONLY valid JSON that matches the provided schema
- No comments, no markdown formatting, no explanations
- The response must be valid JSON that can be parsed directly`;
  }

  // Fallback for schemas without custom prompts
  return `You are an expert data extraction specialist.
You will receive OCR-extracted text and must extract structured data according to the provided schema.

CRITICAL REQUIREMENTS:
- Return ONLY valid JSON that matches the provided schema
- No comments, no markdown formatting, no explanations
- The response must be valid JSON that can be parsed directly`;
}

/**
 * Build Gemini user prompt for OCR text processing with schema and examples
 * Completely generic - no hardcoded extraction logic
 * Uses output schema (pure structure) for output format
 */
export function buildGeminiOCRUserPrompt(
  ocrResult: {
    fullText: string;
    tables: Array<{ headers: string[]; rows: string[][] }>;
    metadata: { documentType?: string };
  },
  pageNumber: number,
  outputSchema?: any,
  examples?: any[] | null
): string {
  const parts = [];

  // Add schema if provided (use output schema - pure structure only)
  if (outputSchema) {
    parts.push("REQUIRED OUTPUT SCHEMA:");
    parts.push("```json");
    parts.push(JSON.stringify(outputSchema, null, 2));
    parts.push("```");
    parts.push("");
  }

  // Add examples if available (limit to 1 per field for conciseness)
  if (examples && examples.length > 0) {
    parts.push("EXAMPLE OUTPUT FORMAT:");
    parts.push("```json");
    // Take only the first example to keep prompt concise
    const limitedExamples = examples.slice(0, 1);
    parts.push(JSON.stringify(limitedExamples, null, 2));
    parts.push("```");
    parts.push("");
  }

  // CRITICAL RULES
  parts.push("CRITICAL RULES FOR MISSING DATA:");
  parts.push(
    '- If you cannot find a value for a field, use null or empty string ("")'
  );
  parts.push(
    "- NEVER use field descriptions, instructions, or placeholder text as values"
  );
  parts.push("- NEVER make up data or use example text");
  parts.push("- Only extract actual data you can see in the document");
  parts.push("");

  // IMPORTANT: Add evidence field requirements
  parts.push("EVIDENCE REQUIREMENTS:");
  parts.push("For EACH extracted item, you MUST also include:");
  parts.push(
    "- sourceText: A complete text snippet containing ALL the values you extracted"
  );
  parts.push(
    "  * If you extracted Quantity='50', ItemCode='ABC', and Specs='Grade A', then sourceText MUST contain '50', 'ABC', AND 'Grade A'"
  );
  parts.push(
    "  * If values come from different locations, concatenate them with '...' separator"
  );
  parts.push(
    "  * Example: 'Item: ABC123 ... Quantity: 50 units ... Specs: Grade A steel'"
  );
  parts.push(
    "- location: Where you found this information (e.g., 'Table 1, Row 3', 'Page 5, Section 2.1')"
  );
  parts.push("");

  // Add OCR content
  parts.push("DOCUMENT CONTENT TO EXTRACT FROM:");
  parts.push(`Page ${pageNumber}:`);
  parts.push("");
  parts.push("FULL TEXT CONTENT:");
  parts.push(ocrResult.fullText);

  if (ocrResult.tables.length > 0) {
    parts.push("");
    parts.push("EXTRACTED TABLES:");
    parts.push(
      ocrResult.tables
        .map(
          (table, i) =>
            `Table ${i + 1}:\nHeaders: ${table.headers.join(" | ")}\n` +
            table.rows.map((row) => row.join(" | ")).join("\n")
        )
        .join("\n\n")
    );
  }

  return parts.join("\n");
}

/**
 * Build Gemini user prompt for batch processing (multiple pages at once)
 * Combines OCR results from multiple pages for better cross-page context
 * Uses output schema (pure structure) for output format
 */
export function buildGeminiBatchOCRUserPrompt(
  batchOCRResults: Array<{
    pageNumber: number;
    fullText: string;
    tables: Array<{ headers: string[]; rows: string[][] }>;
    metadata: { documentType?: string };
  }>,
  outputSchema?: any,
  examples?: any[] | null
): string {
  const parts = [];

  // Add schema if provided (use output schema - pure structure only)
  if (outputSchema) {
    parts.push("REQUIRED OUTPUT SCHEMA:");
    parts.push("```json");
    parts.push(JSON.stringify(outputSchema, null, 2));
    parts.push("```");
    parts.push("");
  }

  // Add examples if available (limit to 1 per field for conciseness)
  if (examples && examples.length > 0) {
    parts.push("EXAMPLE OUTPUT FORMAT:");
    parts.push("```json");
    // Take only the first example to keep prompt concise
    const limitedExamples = examples.slice(0, 1);
    parts.push(JSON.stringify(limitedExamples, null, 2));
    parts.push("```");
    parts.push("");
  }

  // CRITICAL RULES
  parts.push("CRITICAL RULES FOR MISSING DATA:");
  parts.push(
    '- If you cannot find a value for a field, use null or empty string ("")'
  );
  parts.push(
    "- NEVER use field descriptions, instructions, or placeholder text as values"
  );
  parts.push("- NEVER make up data or use example text");
  parts.push("- Only extract actual data you can see in the document");
  parts.push("");

  // IMPORTANT: Add evidence field requirements
  parts.push("EVIDENCE REQUIREMENTS:");
  parts.push("For EACH extracted item, you MUST also include:");
  parts.push(
    "- sourceText: A complete text snippet containing ALL the values you extracted"
  );
  parts.push(
    "  * If you extracted Quantity='50', ItemCode='ABC', and Specs='Grade A', then sourceText MUST contain '50', 'ABC', AND 'Grade A'"
  );
  parts.push(
    "  * If values come from different locations, concatenate them with '...' separator"
  );
  parts.push(
    "  * Example: 'Item: ABC123 ... Quantity: 50 units ... Specs: Grade A steel'"
  );
  parts.push(
    "- location: Include the page number where you found this information (e.g., 'Page 3, Table 1, Row 2')"
  );
  parts.push("");

  // Add batch OCR content from all pages
  parts.push("DOCUMENT CONTENT TO EXTRACT FROM:");
  parts.push(
    `Processing ${batchOCRResults.length} pages in batch (pages ${batchOCRResults[0].pageNumber}-${batchOCRResults[batchOCRResults.length - 1].pageNumber}):`
  );
  parts.push("");

  // Add content from each page in the batch
  batchOCRResults.forEach((ocrResult) => {
    parts.push(`--- PAGE ${ocrResult.pageNumber} ---`);
    parts.push(ocrResult.fullText);

    if (ocrResult.tables.length > 0) {
      parts.push("");
      parts.push(`TABLES ON PAGE ${ocrResult.pageNumber}:`);
      parts.push(
        ocrResult.tables
          .map(
            (table, i) =>
              `Table ${i + 1}:\nHeaders: ${table.headers.join(" | ")}\n` +
              table.rows.map((row) => row.join(" | ")).join("\n")
          )
          .join("\n\n")
      );
    }
    parts.push("");
  });

  return parts.join("\n");
}
