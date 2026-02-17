import type {
  JsonSchemaDefinition,
  JsonSchemaProperty,
  TSchemaProperty
} from "../types";

/**
 * Convert JSON Schema definition to TSchemaProperty array for UI rendering
 * This is the authoritative conversion function used across frontend and backend
 */
export function jsonSchemaToSchemaProperties(
  definition: JsonSchemaDefinition
): TSchemaProperty[] {
  if (!definition || !definition.properties) return [];

  const convert = (
    name: string,
    prop: JsonSchemaProperty,
    parentRequired: string[] | undefined
  ): TSchemaProperty => {
    const required = Array.isArray(parentRequired)
      ? parentRequired.includes(name)
      : false;

    // Handle date type (string with date format)
    if (prop?.type === "string" && prop?.format === "date") {
      return {
        name,
        type: "date",
        title: prop.title || name,
        description: prop.description || "",
        priority: prop.importance || "medium",
        required,
        extractionInstructions: prop.extractionInstructions,
        importance: prop.importance,
        examples: prop.examples
      };
    }

    // Handle arrays
    if (prop?.type === "array") {
      const items = prop.items;

      // Array of objects
      if (items?.type === "object" && items.properties) {
        const fields: TSchemaProperty[] = Object.entries(items.properties).map(
          ([childName, childProp]) =>
            convert(childName, childProp, items.required)
        );

        return {
          name,
          type: "list",
          itemType: "object",
          fields,
          title: prop.title || name,
          description: prop.description || "",
          priority: prop.importance || "medium",
          required,
          extractionInstructions: prop.extractionInstructions,
          importance: prop.importance,
          examples: prop.examples
        };
      }

      // Array of primitives
      const rawItemType = items?.type;
      const isDateArray = rawItemType === "string" && items?.format === "date";

      const itemType: "string" | "number" | "boolean" | "date" = isDateArray
        ? "date"
        : rawItemType === "string" ||
            rawItemType === "number" ||
            rawItemType === "boolean"
          ? rawItemType
          : "string";

      return {
        name,
        type: "list",
        itemType,
        title: prop.title || name,
        description: prop.description || "",
        priority: prop.importance || "medium",
        required,
        extractionInstructions: prop.extractionInstructions,
        importance: prop.importance,
        examples: prop.examples
      };
    }

    // Primitives
    return {
      name,
      type: prop.type || "string",
      title: prop.title || name,
      description: prop.description || "",
      priority: prop.importance || "medium",
      required,
      extractionInstructions: prop.extractionInstructions,
      importance: prop.importance,
      examples: prop.examples
    } as TSchemaProperty;
  };

  // Convert properties and sort by order if available
  const properties = Object.entries(definition.properties).map(
    ([name, prop]) => ({
      property: convert(name, prop, definition.required),
      order: prop.order ?? Number.MAX_SAFE_INTEGER // Properties without order go to the end
    })
  );

  // Sort by order and return just the properties
  return properties
    .sort((a, b) => a.order - b.order)
    .map((item) => item.property);
}

/**
 * Convert TSchemaProperty array to JSON Schema definition
 * This is the authoritative conversion function used across frontend and backend
 */
export function schemaPropertiesToJsonSchema(
  properties: TSchemaProperty[]
): JsonSchemaDefinition {
  const schemaProperties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  const toJson = (prop: TSchemaProperty, order: number): JsonSchemaProperty => {
    // Handle date type
    if (prop.type === "date") {
      return {
        type: "string",
        format: "date",
        title: prop.title,
        description: prop.description,
        importance: prop.importance,
        extractionInstructions: prop.extractionInstructions,
        displayName: prop.title,
        examples: prop.examples,
        order
      };
    }

    // Handle list type
    if (prop.type === "list") {
      const itemType = prop.itemType || "string";

      // List of objects
      if (itemType === "object") {
        const childProperties: Record<string, JsonSchemaProperty> = {};
        const childRequired: string[] = [];

        (prop.fields || []).forEach((f: TSchemaProperty) => {
          childProperties[f.name] = toJson(f, 0); // Nested fields don't need order
          if (f.required) childRequired.push(f.name);
        });

        return {
          type: "array",
          title: prop.title,
          description: prop.description,
          importance: prop.importance,
          extractionInstructions: prop.extractionInstructions,
          displayName: prop.title,
          examples: prop.examples,
          order,
          items: {
            type: "object",
            properties: childProperties,
            required: childRequired.length > 0 ? childRequired : undefined
          }
        };
      }

      // List of primitives (including dates)
      return {
        type: "array",
        title: prop.title,
        description: prop.description,
        importance: prop.importance,
        extractionInstructions: prop.extractionInstructions,
        displayName: prop.title,
        examples: prop.examples,
        order,
        items: {
          type: itemType === "date" ? "string" : itemType,
          format: itemType === "date" ? "date" : undefined
        }
      };
    }

    // Primitives (string, number, boolean)
    return {
      type: prop.type,
      title: prop.title,
      description: prop.description,
      importance: prop.importance,
      extractionInstructions: prop.extractionInstructions,
      displayName: prop.title,
      examples: prop.examples,
      order
    };
  };

  // Preserve the order of properties based on their position in the array
  properties.forEach((prop, index) => {
    schemaProperties[prop.name] = toJson(prop, index);
    if (prop.required) required.push(prop.name);
  });

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    title: "Extraction Schema",
    description: "Schema for extracting structured data from documents",
    properties: schemaProperties,
    required
  };
}

/**
 * Evidence field names that should be separated from extraction data
 */
export const EVIDENCE_FIELDS = [
  "boundingBox",
  "originalSnippet",
  "sourceText",
  "surroundingContext",
  "contextText",
  "ocrConfidence",
  "coordinates",
  "section",
  "documentType",
  "locationInDocument",
  "extractionMethod"
] as const;

/**
 * Separate evidence fields from extraction data
 * Returns both the cleaned extraction data and the evidence object
 */
export function separateEvidenceFromExtraction(
  result: Record<string, unknown>
): {
  extractionData: Record<string, unknown>;
  evidence: {
    boundingBox?: unknown;
    sourceText?: string;
    contextText?: string;
    ocrConfidence?: number;
    extractionMethod?: string;
    locationInDocument?: string;
    metadata?: Record<string, unknown>;
  };
} {
  const evidence = {
    boundingBox: result.boundingBox,
    sourceText: (result.originalSnippet || result.sourceText) as
      | string
      | undefined,
    contextText: (result.surroundingContext || result.contextText) as
      | string
      | undefined,
    ocrConfidence: result.ocrConfidence as number | undefined,
    extractionMethod: (result.extractionMethod || "vision-only") as string,
    locationInDocument: result.locationInDocument as string | undefined,
    metadata: {
      coordinates: result.coordinates,
      section: result.section,
      documentType: result.documentType
    }
  };

  // Clean the extraction data (remove evidence fields)
  const extractionData: Record<string, unknown> = { ...result };
  EVIDENCE_FIELDS.forEach((field) => {
    delete extractionData[field];
  });

  return { extractionData, evidence };
}
