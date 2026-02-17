/**
 * Vision-only extraction utilities
 * Handles prompt building for image-based extraction using Gemini Vision
 */

import { CompiledSchema } from "@packages/types";

/**
 * Build a comprehensive vision extraction prompt for a single page
 */
export function buildVisionExtractionPrompt(
  pageNumber: number,
  fullSchema?: CompiledSchema
): { systemPrompt: string; userPrompt: string } {
  // Build system prompt from schema
  let systemPrompt = "You are an expert document extraction system.";

  if (fullSchema) {
    const enhancedPrompt = fullSchema.prompt;
    if (enhancedPrompt) {
      systemPrompt += ` ${enhancedPrompt}`;
    }
  } else {
    systemPrompt += " Extract all materials and items from the document.";
  }

  // Build extraction context with field-specific instructions
  let extractionContext = "";
  if (fullSchema?.cleanSchema?.properties) {
    extractionContext = "\n\nFIELD EXTRACTION INSTRUCTIONS:\n";
    for (const [fieldName, fieldSchema] of Object.entries<any>(
      fullSchema.cleanSchema.properties
    )) {
      if (fieldSchema.extractionInstructions) {
        extractionContext += `- ${fieldSchema.title || fieldName}: ${fieldSchema.extractionInstructions}\n`;
      }
    }
  }

  // Build user prompt based on whether we have a schema
  const userPrompt = fullSchema?.outputSchema
    ? `Extract data according to this OUTPUT STRUCTURE:
${JSON.stringify(fullSchema.outputSchema, null, 2)}
${extractionContext}

CRITICAL RULES FOR MISSING DATA:
- If you cannot find a value for a field, use null or empty string ("")
- NEVER use field descriptions, instructions, or placeholder text as values
- NEVER make up data or use example text
- Only extract actual data you can see in the document

EVIDENCE REQUIREMENTS:
For EACH extracted item, you MUST also include:
- sourceText: A complete text snippet containing ALL the values you extracted
  * If you extracted Quantity='50', ItemCode='ABC', and Specs='Grade A', then sourceText MUST contain '50', 'ABC', AND 'Grade A'
  * If values come from different locations, concatenate them with '...' separator
  * Example: 'Item: ABC123 ... Quantity: 50 units ... Specs: Grade A steel'
- location: A brief description of where this was found (e.g., 'Table 1, Row 3', 'Section 2.1', 'Page ${pageNumber}')

Return the extracted data as a JSON array of objects matching the OUTPUT STRUCTURE above, with sourceText and location fields added to each object.`
    : `Extract all materials and items from this construction document page.

CRITICAL RULES FOR MISSING DATA:
- If you cannot find a value, use null or empty string ("")
- NEVER use descriptions or placeholder text as values

EVIDENCE REQUIREMENTS:
For EACH extracted item, you MUST also include:
- sourceText: A complete text snippet containing ALL the values you extracted
- location: A brief description of where this was found (e.g., 'Page ${pageNumber}')

Return as a JSON array.`;

  return { systemPrompt, userPrompt };
}

/**
 * Build a comprehensive vision extraction prompt for PDF document or batch
 * Uses Gemini File API to process PDF pages
 *
 * @param fullSchema - The extraction schema
 * @param startPage - Starting page number (1-indexed, optional for full doc)
 * @param endPage - Ending page number (1-indexed, optional for full doc)
 * @param totalPages - Total pages in the original document (optional)
 */
export function buildPDFExtractionPrompt(
  fullSchema?: CompiledSchema,
  startPage?: number,
  endPage?: number,
  totalPages?: number
): {
  systemPrompt: string;
  userPrompt: string;
} {
  // Build system prompt from schema
  let systemPrompt =
    "You are an expert document extraction system specialized in processing PDF documents.";

  if (fullSchema) {
    const enhancedPrompt = fullSchema.prompt;
    if (enhancedPrompt) {
      systemPrompt += ` ${enhancedPrompt}`;
    }
  } else {
    systemPrompt += " Extract all materials and items from the document.";
  }

  // Add batch context if processing a subset of pages
  const batchContext =
    startPage && endPage && totalPages
      ? `\n\nDOCUMENT CONTEXT: You are viewing pages ${startPage}-${endPage} of a ${totalPages}-page document.`
      : "";

  // Build extraction context with field-specific instructions
  let extractionContext = "";
  if (fullSchema?.cleanSchema?.properties) {
    extractionContext = "\n\nFIELD EXTRACTION INSTRUCTIONS:\n";
    for (const [fieldName, fieldSchema] of Object.entries<any>(
      fullSchema.cleanSchema.properties
    )) {
      if (fieldSchema.extractionInstructions) {
        extractionContext += `- ${fieldSchema.title || fieldName}: ${fieldSchema.extractionInstructions}\n`;
      }
    }
  }

  // Build user prompt based on whether we have a schema
  const userPrompt = fullSchema?.outputSchema
    ? `You are viewing a PDF document.${batchContext} Extract all items from the provided pages.

Extract data according to this OUTPUT STRUCTURE:
${JSON.stringify(fullSchema.outputSchema, null, 2)}
${extractionContext}

CRITICAL INSTRUCTIONS FOR MULTI-PAGE ITEMS:
- Items may span across multiple pages within this batch
- When you find partial information about an item, check ALL pages in this PDF before finalizing the extraction
- If an item spans pages within this batch, combine the information into ONE complete item
- Include all page numbers where the item appears in the location field
- Process all provided pages and consider relationships between pages

CRITICAL RULES FOR MISSING DATA:
- If you cannot find a value for a field, use null or empty string ("")
- NEVER use field descriptions, instructions, or placeholder text as values
- NEVER make up data or use example text
- Only extract actual data you can see in the document

EVIDENCE REQUIREMENTS:
For EACH extracted item, you MUST also include:
- sourceText: Extract a brief snippet (max 150 chars) showing just the key identifying information
  * Use ellipsis (...) to truncate longer content SAFELY at word boundaries
  * Example: 'Item ABC123 ... Qty 50 ... Grade A'
  * CRITICAL: Always close quotes properly - if text is too long, stop before the closing quote and use ellipsis
  * Never allow unterminated strings
- location: Brief location reference (e.g., 'Page 3', 'Pages 5-7')

ABSOLUTE JSON FORMATTING REQUIREMENTS (CRITICAL):
- EVERY string field MUST have properly closed quotes
- NEVER cut off in the middle of a word or escape sequence
- Use ellipsis (...) to safely abbreviate content
- If you run out of space in a field, close it with ellipsis BEFORE the closing quote
- Example of SAFE truncation: "Long text here ..." NOT "Long text here"
- Return ONLY valid, parseable JSON
- ALWAYS close the JSON array with ]
- If response is getting long, extract fewer details per item to maintain JSON validity

Return the extracted data as a JSON array matching the OUTPUT STRUCTURE, with sourceText and location fields added.`
    : `You are viewing a PDF document.${batchContext} Extract all materials and items from the provided pages.

CRITICAL INSTRUCTIONS FOR MULTI-PAGE ITEMS:
- Items may span across multiple pages within this batch
- Combine information from all pages in this PDF for each item
- Include all page numbers where the item appears
- Process all provided pages and consider relationships between pages

CRITICAL RULES FOR MISSING DATA:
- If you cannot find a value, use null or empty string ("")
- NEVER use descriptions or placeholder text as values

EVIDENCE REQUIREMENTS:
For EACH extracted item, you MUST also include:
- sourceText: Extract a brief snippet (max 150 chars) showing just the key identifying information
  * Use ellipsis (...) to truncate safely - close quotes BEFORE the ellipsis if text is too long
  * Example: 'Item ABC123 ... Qty 50 ... Grade A'
  * CRITICAL: Always close quotes properly - never leave unterminated strings
- location: Brief location reference (e.g., 'Page 3', 'Pages 5-7')

ABSOLUTE JSON FORMATTING REQUIREMENTS (CRITICAL):
- EVERY string must have properly closed quotes
- NEVER cut off in the middle of a word
- Use ellipsis (...) for safe abbreviation only
- Return ONLY valid, parseable JSON with all brackets closed
- If response gets too long, extract fewer details per item

Return as a valid JSON array of all items found in the provided pages. Always close with ].`;

  return { systemPrompt, userPrompt };
}
