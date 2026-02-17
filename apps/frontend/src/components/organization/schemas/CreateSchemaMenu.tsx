import type { SchemaProperty } from "@packages/types";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@packages/ui";
import { FileText, Plus, Sparkles } from "lucide-react";
import { AIGenerationDialog } from "@/components/ai/AIGenerationDialog";

interface CreateSchemaMenuProps {
  onCreateManual: () => void;
  onGenerateWithAI: (data: {
    properties: SchemaProperty[];
    prompt: string;
    examples: Record<string, unknown>[];
  }) => void;
}

interface AIGeneratedSchemaData {
  properties: SchemaProperty[];
  prompt: string;
  examples: Record<string, unknown>[];
}

const SYSTEM_PROMPT = `You are an AI assistant that helps create complete extraction schemas for document processing.

Generate a comprehensive extraction schema where EACH EXTRACTABLE FIELD has its own extraction instructions and examples.

Return ONLY a JSON object with this exact structure:
{
  "properties": [
    {
      "name": "camelCasePropertyName",
      "type": "string" | "number" | "boolean" | "date" | "list",
      "itemType": "string" | "number" | "boolean" | "date" | "object", // required if type is "list"
      "fields": [ /* array of nested properties, required if itemType is "object" */ ],
      "title": "Human Readable Title",
      "description": "Brief description of what this property represents",
      "priority": "high" | "medium" | "low",
      "required": boolean,
      "extractionInstructions": "Detailed instructions for extracting THIS specific field",
      "importance": "high" | "medium" | "low",
      "examples": [
        {
          "id": "unique-id-1",
          "input": "Example text from document where this field appears",
          "output": "The extracted value for this field"
        }
      ]
    }
  ],
  "prompt": "General extraction instructions that apply to the entire schema.",
  "examples": []
}

CRITICAL REQUIREMENTS:
- Property names must be camelCase (e.g., "itemCode", "itemName", "invoiceDate")
- Types must be: "string", "number", "boolean", "date", or "list"
- Use "date" type for date fields (not string)
- If type is "list", include a valid "itemType" ("string" | "number" | "boolean" | "date" | "object")
- If itemType is "object", include a "fields" array describing the nested structure
- Nested fields in object lists can only be primitives (string, number, boolean, date) - no further nesting
- Priority and importance must be: "high", "medium", or "low"
- All extractable fields MUST have "extractionInstructions" and "examples"
- Each example must have: "id" (unique string), "input" (source text), "output" (extracted value)
- For date fields, provide examples showing the expected date format (e.g., "2024-01-15")
- For object lists, provide extraction instructions at the list level and examples showing the full object structure
- The schema-level "prompt" should contain general guidance about the document type
- The schema-level "examples" should be empty array
- No markdown, no explanations, only the JSON object`;

const generatePrompt = (userInput: string) => {
  return `Based on this description, create a complete extraction schema with property-level extraction guidance:

"${userInput}"

Create a comprehensive schema where:
1. Each extractable field (string, number, boolean, date, list) has "extractionInstructions" and "examples"
2. Use "date" type for date fields with examples in YYYY-MM-DD format
3. For lists of objects (itemType: "object"), include a "fields" array with nested properties
4. Nested fields can only be primitives (string, number, boolean, date) - no lists of objects within objects
5. Each example has: "id" (unique string like "ex1", "ex2"), "input" (source text snippet), "output" (extracted value)
6. The schema-level "prompt" contains general guidance about the document type
7. The schema-level "examples" is an empty array

Focus on making the property-level instructions and examples detailed and practical.

Return the JSON object with properties containing extractionInstructions and examples for each extractable field.`;
};

const parseResponse = (response: string): AIGeneratedSchemaData => {
  try {
    // Try to extract JSON if it's wrapped in other text
    const jsonMatch =
      response.match(/```json\s*([\s\S]*?)\s*```/) ||
      response.match(/\{[\s\S]*\}/);

    let jsonText = response;
    if (jsonMatch) {
      jsonText = jsonMatch[0].replace(/```(json)?\s*|\s*```/g, "").trim();
    }

    const parsed = JSON.parse(jsonText);

    // Validate the structure
    if (!parsed.properties || !Array.isArray(parsed.properties)) {
      throw new Error("Invalid schema: missing properties array");
    }

    if (!parsed.prompt || typeof parsed.prompt !== "string") {
      throw new Error("Invalid schema: missing or invalid prompt");
    }

    if (!parsed.examples || !Array.isArray(parsed.examples)) {
      throw new Error("Invalid schema: missing examples array");
    }

    // Validate that extractable properties have extraction instructions and examples
    const validateProperty = (
      prop: any,
      path: string = "",
      depth: number = 0
    ): void => {
      const propPath = path ? `${path}.${prop.name}` : prop.name;

      // Validate type
      const validTypes = ["string", "number", "boolean", "date", "list"];
      if (!validTypes.includes(prop.type)) {
        throw new Error(
          `Property "${propPath}" has invalid type "${prop.type}". Must be one of: ${validTypes.join(", ")}`
        );
      }

      // Validate list properties
      if (prop.type === "list") {
        const validItemTypes = [
          "string",
          "number",
          "boolean",
          "date",
          "object"
        ];
        if (!prop.itemType || !validItemTypes.includes(prop.itemType)) {
          throw new Error(
            `Property "${propPath}" is a list but has invalid or missing itemType. Must be one of: ${validItemTypes.join(", ")}`
          );
        }

        // Validate object lists
        if (prop.itemType === "object") {
          if (!Array.isArray(prop.fields) || prop.fields.length === 0) {
            throw new Error(
              `Property "${propPath}" is a list of objects but has no fields defined.`
            );
          }

          // Prevent deep nesting (only one level allowed)
          if (depth > 0) {
            throw new Error(
              `Property "${propPath}" is nested too deeply. Object lists can only contain primitive fields.`
            );
          }

          // Validate nested fields
          prop.fields.forEach((field: any) =>
            validateProperty(field, propPath, depth + 1)
          );
        }
      }

      // Validate nested fields don't have lists of objects
      if (depth > 0 && prop.type === "list" && prop.itemType === "object") {
        throw new Error(
          `Property "${propPath}" cannot be a list of objects within another object list. Only one level of nesting is supported.`
        );
      }

      // Validate extraction instructions and examples for extractable fields
      if (
        !prop.extractionInstructions ||
        typeof prop.extractionInstructions !== "string"
      ) {
        console.warn(
          `Property "${propPath}" is missing extractionInstructions.`
        );
      }

      // Examples are optional - just warn if missing
      if (!Array.isArray(prop.examples) || prop.examples.length === 0) {
        console.warn(
          `Property "${propPath}" is missing examples. Examples help improve extraction accuracy.`
        );
      } else {
        // Validate example structure if examples are provided
        prop.examples.forEach((ex: any, idx: number) => {
          if (!ex.id || typeof ex.id !== "string") {
            throw new Error(
              `Property "${propPath}" example ${idx + 1} is missing "id" field.`
            );
          }
          if (!ex.input || typeof ex.input !== "string") {
            throw new Error(
              `Property "${propPath}" example ${idx + 1} is missing "input" field.`
            );
          }
          if (ex.output === undefined || ex.output === null) {
            throw new Error(
              `Property "${propPath}" example ${idx + 1} is missing "output" field.`
            );
          }
        });
      }
    };

    parsed.properties.forEach((prop: any) => validateProperty(prop));

    // Map properties to the correct format (supports nested fields for object lists)
    const mapProp = (prop: Record<string, unknown>): SchemaProperty => {
      const mapped: SchemaProperty = {
        name: (prop.name as string) || "",
        type: (prop.type as any) || "string",
        title: (prop.title as string) || (prop.name as string) || "",
        description: (prop.description as string) || "",
        priority: (prop.priority as any) || "medium",
        required: Boolean(prop.required),
        importance:
          (prop.importance as any) || (prop.priority as any) || "medium"
      };

      // Only include examples if it's a valid array
      if (Array.isArray(prop.examples) && prop.examples.length > 0) {
        mapped.examples = prop.examples as any[];
      }

      // Only set extractionInstructions if it exists (to satisfy exactOptionalPropertyTypes)
      if (
        prop.extractionInstructions &&
        typeof prop.extractionInstructions === "string"
      ) {
        mapped.extractionInstructions = prop.extractionInstructions;
      }

      // Handle list-specific properties
      if (prop.type === "list") {
        mapped.itemType = prop.itemType as any;

        // Handle object lists with nested fields
        if (prop.itemType === "object" && Array.isArray(prop.fields)) {
          mapped.fields = (prop.fields as any[]).map((f) => mapProp(f));
        }
      }

      return mapped;
    };

    const properties: SchemaProperty[] = parsed.properties.map(
      (prop: Record<string, unknown>) => mapProp(prop)
    );

    return {
      properties,
      prompt: parsed.prompt,
      examples: parsed.examples
    };
  } catch {
    throw new Error("Failed to parse AI response. Please try again.");
  }
};

export function CreateSchemaMenu({
  onCreateManual,
  onGenerateWithAI
}: CreateSchemaMenuProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" />
          New Schema
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <div className="space-y-1">
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={onCreateManual}
          >
            <FileText className="h-4 w-4 mr-2" />
            Create Manually
          </Button>

          <AIGenerationDialog<AIGeneratedSchemaData>
            buttonText="Generate with AI"
            title="Generate Schema with AI"
            description="Describe what information you want to extract from documents. AI will create properties, extraction instructions, and examples."
            placeholder="e.g., I want to extract material information including item code, name, quantity, unit, and price from construction invoices..."
            buttonIcon={<Sparkles className="h-4 w-4 mr-2" />}
            buttonVariant="ghost"
            buttonSize="default"
            buttonClassName="w-full justify-start hover:bg-accent"
            format="dialog"
            systemPrompt={SYSTEM_PROMPT}
            generatePrompt={generatePrompt}
            parseResponse={parseResponse}
            onGenerate={onGenerateWithAI}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
