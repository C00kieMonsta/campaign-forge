/**
 * Schema utility functions
 * These functions convert between JSON Schema and SchemaProperty formats
 */
import {
  JSON_SCHEMA_ESSENTIAL_FIELDS,
  JSON_SCHEMA_PROPERTY_FIELDS,
  MAX_DESCRIPTION_LENGTH,
  MAX_SCHEMA_SIZE_BYTES
} from "../constants";
import type {
  JsonSchemaDefinition,
  JsonSchemaProperty,
  SchemaProperty
} from "./types";

/**
 * Convert JSON Schema definition to SchemaProperty array for UI rendering
 */
export function jsonSchemaToSchemaProperties(
  definition: JsonSchemaDefinition
): SchemaProperty[] {
  if (!definition || !definition.properties) return [];

  const convert = (
    name: string,
    prop: any,
    parentRequired: string[] | undefined
  ): SchemaProperty => {
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
        const fields: SchemaProperty[] = Object.entries(items.properties).map(
          ([childName, childProp]: [string, any]) =>
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
    } as SchemaProperty;
  };

  // Convert properties and sort by order if available
  const properties = Object.entries(definition.properties).map(
    ([name, prop]: [string, any]) => ({
      property: convert(name, prop, definition.required),
      order: prop.order ?? Number.MAX_SAFE_INTEGER
    })
  );

  // Sort by order and return just the properties
  return properties
    .sort((a, b) => a.order - b.order)
    .map((item) => item.property);
}

/**
 * Convert SchemaProperty array to JSON Schema definition
 */
export function schemaPropertiesToJsonSchema(
  properties: SchemaProperty[]
): JsonSchemaDefinition {
  const schemaProperties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  const toJson = (prop: SchemaProperty, order: number): JsonSchemaProperty => {
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

        (prop.fields || []).forEach((f: SchemaProperty) => {
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

type JsonSchemaValue = Record<string, unknown> | unknown;

/**
 * Check if a schema exceeds the size limit
 */
export function isSchemaOversized(schema: JsonSchemaValue): boolean {
  try {
    const schemaString = JSON.stringify(schema);
    return schemaString.length > MAX_SCHEMA_SIZE_BYTES;
  } catch {
    return false;
  }
}

/**
 * Get schema size in bytes
 */
export function getSchemaSize(schema: JsonSchemaValue): number {
  try {
    return JSON.stringify(schema).length;
  } catch {
    return 0;
  }
}

/**
 * Keep only essential schema structure fields
 */
export function filterEssentialFields(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};

  for (const key of JSON_SCHEMA_ESSENTIAL_FIELDS) {
    if (key in schema) {
      filtered[key] = schema[key];
    }
  }

  return filtered;
}

/**
 * Filter property fields and optionally truncate descriptions
 */
export function filterPropertyFields(
  property: Record<string, unknown>,
  truncateDesc = true
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};

  for (const field of JSON_SCHEMA_PROPERTY_FIELDS) {
    if (field in property) {
      if (field === "description" && truncateDesc) {
        const desc = String(property[field]);
        filtered[field] =
          desc.length > MAX_DESCRIPTION_LENGTH
            ? desc.substring(0, MAX_DESCRIPTION_LENGTH)
            : desc;
      } else {
        filtered[field] = property[field];
      }
    }
  }

  return filtered;
}

/**
 * Create minimal properties (type only) for oversized schemas
 */
export function createMinimalProperties(
  properties: Record<string, unknown>
): Record<string, { type?: string }> {
  const minimal: Record<string, { type?: string }> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const typedValue = value as Record<string, unknown>;
      minimal[key] = {
        type: (typedValue.type as string) || "string"
      };
    } else {
      minimal[key] = value as { type?: string };
    }
  }

  return minimal;
}

/**
 * Recursively optimize JSON schema by removing verbose metadata
 */
export function optimizeJsonSchema(schema: JsonSchemaValue): JsonSchemaValue {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }

  const schemaObj = schema as Record<string, unknown>;
  const optimized = filterEssentialFields(schemaObj) as Record<string, unknown>;

  // Recursively optimize properties
  if (schemaObj.properties && typeof schemaObj.properties === "object") {
    const optimizedProps: Record<string, unknown> = {};
    const props = schemaObj.properties as Record<string, unknown>;
    for (const [propKey, propValue] of Object.entries(props)) {
      if (
        typeof propValue === "object" &&
        propValue !== null &&
        !Array.isArray(propValue)
      ) {
        const propObj = propValue as Record<string, unknown>;
        const optimizedProp = filterPropertyFields(propObj) as Record<
          string,
          unknown
        >;

        // Recursively optimize nested properties
        if (propObj.properties) {
          optimizedProp.properties = optimizeJsonSchema(propObj.properties);
        }
        if (propObj.items) {
          optimizedProp.items = optimizeJsonSchema(propObj.items);
        }

        optimizedProps[propKey] = optimizedProp;
      } else {
        optimizedProps[propKey] = propValue;
      }
    }
    optimized.properties = optimizedProps;
  }

  // Recursively optimize items for arrays
  if (
    schemaObj.items &&
    typeof schemaObj.items === "object" &&
    !Array.isArray(schemaObj.items)
  ) {
    optimized.items = optimizeJsonSchema(schemaObj.items);
  }

  // Recursively optimize compound schemas
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schemaObj[key])) {
      optimized[key] = (schemaObj[key] as unknown[]).map((item) =>
        optimizeJsonSchema(item)
      );
    }
  }

  return optimized;
}

/**
 * Optimize schema and further minimize if it exceeds size limit
 */
export function optimizeSchemaWithSizeCheck(
  schema: JsonSchemaValue
): JsonSchemaValue {
  // First pass: remove metadata
  let optimized = optimizeJsonSchema(schema);

  // Second pass: minimize if too large
  if (isSchemaOversized(optimized)) {
    const optimizedObj = optimized as Record<string, unknown>;
    optimized = {
      $schema: optimizedObj.$schema,
      type: optimizedObj.type,
      properties: createMinimalProperties(
        (optimizedObj.properties as Record<string, unknown>) || {}
      ),
      required: optimizedObj.required
    };
  }

  return optimized;
}
