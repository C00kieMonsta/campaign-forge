import { Injectable, Logger } from "@nestjs/common";
import {
  AgentDefinitionCompiled,
  AgentExample,
  AUTHOR_SCHEMA_META_SCHEMA,
  CompiledSchema,
  ExtractionSchema,
  JsonSchema,
  JsonSchemaDefinition,
  JsonSchemaProperty,
  PROPERTY_IMPORTANCE_VALUES,
  PropertyWithGuidance,
  VALID_SCHEMA_TYPES,
  ValidationResultUnion
} from "@packages/types";
import Ajv, { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { z } from "zod";

/**
 * Converts a JSON Schema object to a Zod schema.
 * Supports the most common JSON Schema constructs for extraction use cases.
 */
function jsonSchemaToZod(
  schema: JsonSchemaProperty | JsonSchemaDefinition
): z.ZodTypeAny {
  const schemaObj = schema as unknown as Record<string, unknown>;
  const schemaType = schemaObj.type as unknown;

  if (schemaType === VALID_SCHEMA_TYPES.OBJECT) {
    const shape: Record<string, z.ZodTypeAny> = {};
    const properties = (schemaObj.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;

    for (const [key, propSchema] of Object.entries(properties)) {
      let zodField = jsonSchemaToZod(
        propSchema as unknown as JsonSchemaProperty
      );

      const required = schemaObj.required as string[] | undefined;
      if (!required?.includes(key)) {
        zodField = zodField.optional();
      }

      shape[key] = zodField;
    }

    const baseObject = z.object(shape);
    return schemaObj.additionalProperties === false
      ? baseObject.strict()
      : baseObject;
  }

  if (schemaType === VALID_SCHEMA_TYPES.STRING) {
    if (schemaObj.format === "date") {
      return z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");
    }

    if (Array.isArray(schemaObj.enum)) {
      return z.enum(schemaObj.enum as [string, ...string[]]);
    }

    let stringSchema = z.string();
    if (typeof schemaObj.minLength === "number") {
      stringSchema = stringSchema.min(schemaObj.minLength as number);
    }
    if (typeof schemaObj.maxLength === "number") {
      stringSchema = stringSchema.max(schemaObj.maxLength as number);
    }
    return stringSchema;
  }

  if (
    schemaType === VALID_SCHEMA_TYPES.NUMBER ||
    schemaType === VALID_SCHEMA_TYPES.INTEGER
  ) {
    let numberSchema = z.number();
    if (typeof schemaObj.minimum === "number") {
      numberSchema = numberSchema.min(schemaObj.minimum as number);
    }
    if (typeof schemaObj.maximum === "number") {
      numberSchema = numberSchema.max(schemaObj.maximum as number);
    }
    if (schemaType === VALID_SCHEMA_TYPES.INTEGER) {
      numberSchema = numberSchema.int();
    }
    return numberSchema;
  }

  if (schemaType === VALID_SCHEMA_TYPES.BOOLEAN) {
    return z.boolean();
  }

  if (schemaType === VALID_SCHEMA_TYPES.ARRAY) {
    const itemsSchema = (schemaObj.items ?? { type: "object" }) as Record<
      string,
      unknown
    >;
    return z.array(
      jsonSchemaToZod(itemsSchema as unknown as JsonSchemaProperty)
    );
  }

  return z.unknown();
}

@Injectable()
export class SchemaCompilerService {
  private readonly logger = new Logger(SchemaCompilerService.name);
  private readonly ajv: Ajv;
  private readonly authorValidator: ValidateFunction;

  constructor() {
    // Initialize AJV with draft-07 support
    this.ajv = new Ajv({
      strict: false, // Relax strict mode for compatibility
      allErrors: true
    });
    addFormats(this.ajv);
    this.authorValidator = this.ajv.compile(AUTHOR_SCHEMA_META_SCHEMA);
  }

  /**
   * Validates that an author-provided schema conforms to our supported subset.
   */
  validateAuthorSchema(definition: JsonSchema | Record<string, unknown>): void {
    const isValid = this.authorValidator(definition as unknown);

    if (!isValid) {
      const errors =
        this.authorValidator.errors
          ?.map((error) => `${error.instancePath} ${error.message}`)
          .join("; ") || "Invalid schema";

      throw new Error(`Invalid author schema: ${errors}`);
    }
  }

  /**
   * Compiles an author-provided JSON Schema into all necessary artifacts:
   * - Validated JSON Schema
   * - Zod schema for runtime validation
   * - Clean schema for LLM consumption (with instructions for context)
   * - Output schema for LLM response structure (pure structure only)
   */
  compile(definition: JsonSchema): CompiledSchema {
    // First, validate that the author schema is acceptable
    this.validateAuthorSchema(definition);

    // Convert JSON Schema to Zod schema
    const zodSchema = jsonSchemaToZod(definition);

    // Create clean schema for LLM (strips verbose metadata, keeps instructions)
    const cleanSchema = this.createCleanSchemaForLLM(definition);

    // Create output schema for LLM (strips ALL metadata including instructions)
    const outputSchema = this.createOutputSchemaForLLM(definition);

    const schemaAsRecord = definition as unknown as Record<string, unknown>;

    return {
      zod: zodSchema,
      jsonSchema: schemaAsRecord,
      cleanSchema,
      outputSchema,
      zodMeta: {
        jsonSchema: schemaAsRecord
      }
    };
  }

  /**
   * Validates data against a compiled schema.
   * Returns both success/failure and detailed error information.
   */
  validateData(
    compiledSchema: CompiledSchema,
    data: Record<string, unknown>
  ): ValidationResultUnion<Record<string, unknown>> {
    const result = compiledSchema.zod.safeParse(data);

    if (result.success) {
      return { success: true, data: result.data as Record<string, unknown> };
    } else {
      return {
        success: false,
        errors: result.error.format()
      };
    }
  }

  /**
   * Creates a clean schema for LLM consumption by stripping verbose metadata.
   * Keeps only: type, title, required, properties, items (structure), and capped extractionInstructions.
   * Removes: description, examples, displayName, importance.
   *
   * @param jsonSchema - The full JSON Schema with all metadata
   * @returns A cleaned schema suitable for LLM prompts (includes instructions in properties)
   */
  createCleanSchemaForLLM(
    jsonSchema: JsonSchemaProperty
  ): Record<string, unknown> {
    if (!jsonSchema || typeof jsonSchema !== "object") {
      return {};
    }

    const cleanSchema: Record<string, unknown> = {
      type: (jsonSchema as JsonSchema).type,
      title: jsonSchema.title,
      required: jsonSchema.required
    };

    // Process properties if present
    if (jsonSchema.properties) {
      cleanSchema.properties = {} as Record<string, unknown>;
      const propertiesObj = cleanSchema.properties as Record<string, unknown>;

      for (const [fieldName, fieldSchema] of Object.entries(
        jsonSchema.properties
      )) {
        const cleanField: Record<string, unknown> = {
          type: fieldSchema.type,
          title: fieldSchema.title
        };

        // Keep extractionInstructions but cap to 500 characters
        if (fieldSchema.extractionInstructions) {
          const instructions = fieldSchema.extractionInstructions;
          if (instructions.length > 500) {
            cleanField.extractionInstructions =
              instructions.substring(0, 500) + "...";
            this.logger.warn(
              `Truncated extractionInstructions for field "${fieldName}" from ${instructions.length} to 500 chars`
            );
          } else {
            cleanField.extractionInstructions = instructions;
          }
        }

        // Handle nested array items
        if (fieldSchema.items) {
          cleanField.items = this.createCleanSchemaForLLM(fieldSchema.items);
        }

        // Handle enum values
        if (fieldSchema.enum) {
          cleanField.enum = fieldSchema.enum;
        }

        propertiesObj[fieldName] = cleanField;
      }
    }

    // Handle items for array schemas
    if (jsonSchema.items) {
      cleanSchema.items = this.createCleanSchemaForLLM(jsonSchema.items);
    }

    return cleanSchema;
  }

  /**
   * Creates a minimal output schema for LLM response structure.
   * Strips ALL metadata including extractionInstructions - only keeps pure structure.
   * This is what the LLM should match in its output JSON.
   *
   * @param jsonSchema - The full JSON Schema with all metadata
   * @returns A minimal schema with only structure (type, title, required, properties)
   */
  createOutputSchemaForLLM(
    jsonSchema: JsonSchemaProperty
  ): Record<string, unknown> {
    if (!jsonSchema || typeof jsonSchema !== "object") {
      return {};
    }

    const outputSchema: Record<string, unknown> = {
      type: (jsonSchema as JsonSchema).type,
      title: jsonSchema.title,
      required: jsonSchema.required
    };

    // Process properties if present - keep ONLY structure
    if (jsonSchema.properties) {
      outputSchema.properties = {} as Record<string, unknown>;
      const propertiesObj = outputSchema.properties as Record<string, unknown>;

      for (const [fieldName, fieldSchema] of Object.entries(
        jsonSchema.properties
      )) {
        const outputField: Record<string, unknown> = {
          type: fieldSchema.type,
          title: fieldSchema.title
        };

        // Handle nested array items
        if (fieldSchema.items) {
          outputField.items = this.createOutputSchemaForLLM(fieldSchema.items);
        }

        // Handle enum values
        if (fieldSchema.enum) {
          outputField.enum = fieldSchema.enum;
        }

        propertiesObj[fieldName] = outputField;
      }
    }

    // Handle items for array schemas
    if (jsonSchema.items) {
      outputSchema.items = this.createOutputSchemaForLLM(jsonSchema.items);
    }

    return outputSchema;
  }

  /**
   * Generates a comprehensive extraction prompt by combining:
   * - General instructions (from schema.prompt)
   * - Schema definition
   * - Property-specific instructions (from extractionInstructions field)
   * - Examples (from examples array)
   *
   * @param schema - The extraction schema containing general prompt and metadata
   * @param compiledSchema - The compiled schema with JSON Schema definition
   * @returns A comprehensive extraction prompt string
   */
  generateExtractionPrompt(
    schema: { prompt?: string | null; name?: string },
    compiledSchema: CompiledSchema
  ): string {
    const parts: string[] = [];

    // 1. Add general instructions if present (cap to 3000 chars)
    if (schema.prompt) {
      parts.push("# General Instructions");
      const prompt = schema.prompt;
      if (prompt.length > 3000) {
        parts.push(prompt.substring(0, 3000) + "...");
        this.logger.warn(
          `Truncated schema-level prompt from ${prompt.length} to 3000 chars`
        );
      } else {
        parts.push(prompt);
      }
      parts.push(""); // Empty line for spacing
    }

    // 2. Add schema structure
    parts.push("# Data Structure");
    parts.push(
      "Extract data according to the following JSON schema structure:"
    );
    parts.push("```json");
    parts.push(JSON.stringify(compiledSchema.jsonSchema, null, 2));
    parts.push("```");
    parts.push(""); // Empty line for spacing

    // 3. Add property-specific guidance
    const properties = (compiledSchema.jsonSchema.properties || {}) as Record<
      string,
      PropertyWithGuidance
    >;
    const hasPropertyGuidance = Object.values(properties).some(
      (prop: PropertyWithGuidance) =>
        prop.extractionInstructions ||
        (prop.examples &&
          Array.isArray(prop.examples) &&
          prop.examples.length > 0)
    );

    if (hasPropertyGuidance) {
      parts.push("# Field-Specific Extraction Guidance");
      parts.push(""); // Empty line for spacing

      for (const [fieldName, fieldSchema] of Object.entries(properties)) {
        const hasInstructions = fieldSchema.extractionInstructions;
        const hasExamples =
          fieldSchema.examples &&
          Array.isArray(fieldSchema.examples) &&
          fieldSchema.examples.length > 0;

        if (hasInstructions || hasExamples) {
          // Add field header with display name or field name
          const displayName =
            fieldSchema.displayName || fieldSchema.title || fieldName;

          // Special handling for list of objects
          const isObjectArray =
            fieldSchema.type === "array" &&
            fieldSchema.items?.type === "object";

          if (isObjectArray) {
            parts.push(`## ${displayName} (List of Objects)`);
          } else {
            parts.push(`## ${displayName}`);
          }

          // Add importance indicator if present
          if (fieldSchema.importance) {
            const importanceLabel = fieldSchema.importance.toUpperCase();
            parts.push(`**Importance:** ${importanceLabel}`);
          }

          // Add extraction instructions (capped to 500 chars)
          if (hasInstructions && fieldSchema.extractionInstructions) {
            parts.push("");
            parts.push("**Extraction Instructions:**");
            const instructions = fieldSchema.extractionInstructions;
            if (instructions.length > 500) {
              parts.push(instructions.substring(0, 500) + "...");
              this.logger.warn(
                `Truncated extractionInstructions for field "${fieldName}" in prompt from ${instructions.length} to 500 chars`
              );
            } else {
              parts.push(instructions);
            }
          }

          // Document nested structure for object arrays
          if (
            isObjectArray &&
            fieldSchema.items &&
            "properties" in fieldSchema.items &&
            fieldSchema.items.properties
          ) {
            parts.push("");
            parts.push("**Object Structure:**");
            Object.entries(fieldSchema.items.properties).forEach(
              ([nestedName, nestedProp]) => {
                const typedProp = nestedProp as JsonSchemaProperty;
                const nestedType =
                  typedProp.type === "string" && typedProp.format === "date"
                    ? "date"
                    : typedProp.type;
                const nestedDesc = typedProp.description || "";
                parts.push(`- ${nestedName} (${nestedType}): ${nestedDesc}`);
              }
            );
          }

          // Add examples (show all examples)
          if (hasExamples && fieldSchema.examples) {
            parts.push("");
            parts.push("**Examples:**");
            fieldSchema.examples.forEach(
              (example: AgentExample, index: number) => {
                const exampleNum = index + 1;
                parts.push(`${exampleNum}. Input: "${example.input}"`);
                // Format output based on whether it's an object/array
                if (typeof example.output === "object") {
                  parts.push(
                    `Output: ${JSON.stringify(example.output, null, 2)}`
                  );
                } else {
                  // For scalar values, wrap in object with field name
                  parts.push(`Output:`);
                  parts.push(
                    `${JSON.stringify({ [fieldName]: example.output }, null, 2)}`
                  );
                }
              }
            );
          }

          parts.push(""); // Empty line between fields
        }
      }
    }

    return parts.join("\n");
  }

  /**
   * Validates schema structure including property-level extraction guidance fields.
   * These fields (importance, extractionInstructions, displayName, examples) are optional.
   *
   * @param definition - The JSON Schema definition to validate (ExtractionSchema or plain definition)
   */
  validateEnhancedSchema(
    definition: ExtractionSchema | JsonSchemaDefinition
  ): void {
    // Handle both ExtractionSchema object and plain definition object
    const schemaDefinition =
      "definition" in definition && definition.definition !== undefined
        ? definition.definition
        : (definition as JsonSchemaDefinition);

    if (
      !schemaDefinition ||
      schemaDefinition === null ||
      Object.keys(schemaDefinition).length === 0
    ) {
      throw new Error(
        "Schema definition is required and cannot be null or empty"
      );
    }

    this.validateAuthorSchema(
      schemaDefinition as JsonSchemaDefinition | Record<string, unknown>
    );

    const definitionObj = schemaDefinition as
      | Record<string, Record<string, unknown>>
      | undefined;
    const properties = (definitionObj?.properties ??
      ({} as Record<string, Record<string, unknown>>)) as Record<
      string,
      Record<string, unknown>
    >;

    for (const [fieldName, fieldSchema] of Object.entries(properties)) {
      // Validate importance
      const importance = fieldSchema.importance as string | undefined;
      if (
        importance !== undefined &&
        !PROPERTY_IMPORTANCE_VALUES.includes(
          importance as "high" | "medium" | "low"
        )
      ) {
        throw new Error(
          `Invalid importance value for field "${fieldName}". Must be "high", "medium", or "low"`
        );
      }

      // Validate displayName
      const displayName = fieldSchema.displayName;
      if (displayName !== undefined && typeof displayName !== "string") {
        throw new Error(
          `displayName for field "${fieldName}" must be a string`
        );
      }

      // Validate extractionInstructions
      const extractionInstructions = fieldSchema.extractionInstructions;
      if (
        extractionInstructions !== undefined &&
        typeof extractionInstructions !== "string"
      ) {
        throw new Error(
          `extractionInstructions for field "${fieldName}" must be a string`
        );
      }

      // Validate examples
      const examples = fieldSchema.examples;
      if (examples !== undefined) {
        if (!Array.isArray(examples)) {
          throw new Error(`Examples for field "${fieldName}" must be an array`);
        }

        examples.forEach((example, index) => {
          if (typeof example !== "object" || example === null) {
            throw new Error(
              `Example ${index + 1} for field "${fieldName}" must be an object`
            );
          }

          const ex = example as Record<string, unknown>;
          if (typeof ex.input !== "string") {
            throw new Error(
              `Example ${index + 1} for field "${fieldName}" must have a string "input" property`
            );
          }

          if (typeof ex.output !== "string") {
            throw new Error(
              `Example ${index + 1} for field "${fieldName}" must have a string "output" property`
            );
          }
        });
      }
    }
  }

  /**
   * Validates agent definitions array structure and constraints.
   * Enforces:
   * - Maximum 10 agents per schema
   * - Unique agent names within schema
   * - Unique order values within schema
   * - Field length constraints (name: 100, prompt: 5000, description: 500)
   * - Positive integer order values
   *
   * @param agents - The agents array to validate
   * @throws Error if validation fails with specific error messages
   */
  validateAgents(agents: unknown): void {
    // Validate agents is an array
    if (!Array.isArray(agents)) {
      throw new Error("Agents must be an array");
    }

    // Validate max 10 agents constraint
    if (agents.length > 10) {
      throw new Error("Maximum 10 agents allowed per schema");
    }

    // Track names and orders for uniqueness validation
    const seenNames = new Set<string>();
    const seenOrders = new Set<number>();

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];

      // Validate agent is an object
      if (typeof agent !== "object" || agent === null) {
        throw new Error(`Agent at index ${i} must be an object`);
      }

      const agentObj = agent as Record<string, unknown>;
      const { name, prompt, order, enabled, description } = agentObj;

      // Validate required fields exist
      if (name === undefined || name === null) {
        throw new Error(`Agent at index ${i} must have a name`);
      }
      if (prompt === undefined || prompt === null) {
        throw new Error(`Agent at index ${i} must have a prompt`);
      }
      if (order === undefined || order === null) {
        throw new Error(`Agent at index ${i} must have an order`);
      }

      // Validate name is a string
      if (typeof name !== "string") {
        throw new Error(`Agent name at index ${i} must be a string`);
      }

      // Validate name length constraint
      if (name.length === 0) {
        throw new Error(`Agent name at index ${i} must not be empty`);
      }
      if (name.length > 100) {
        throw new Error("Agent name must not exceed 100 characters");
      }

      // Validate name uniqueness
      if (seenNames.has(name)) {
        throw new Error("Agent names must be unique within schema");
      }
      seenNames.add(name);

      // Validate prompt is a string
      if (typeof prompt !== "string") {
        throw new Error(`Agent prompt at index ${i} must be a string`);
      }

      // Validate prompt length constraint
      if (prompt.length === 0) {
        throw new Error(`Agent prompt at index ${i} must not be empty`);
      }
      if (prompt.length > 5000) {
        throw new Error("Agent prompt must not exceed 5000 characters");
      }

      // Validate order is a number
      if (typeof order !== "number") {
        throw new Error(`Agent order at index ${i} must be a number`);
      }

      // Validate order is a positive integer
      if (!Number.isInteger(order) || order <= 0) {
        throw new Error("Agent order must be a positive integer");
      }

      // Validate order uniqueness
      if (seenOrders.has(order)) {
        throw new Error("Agent order values must be unique within schema");
      }
      seenOrders.add(order);

      // Validate enabled is a boolean if present
      if (enabled !== undefined && typeof enabled !== "boolean") {
        throw new Error(`Agent enabled at index ${i} must be a boolean`);
      }

      // Validate description if present
      if (description !== undefined) {
        if (typeof description !== "string") {
          throw new Error(`Agent description at index ${i} must be a string`);
        }
        if (description.length > 500) {
          throw new Error("Agent description must not exceed 500 characters");
        }
      }
    }
  }

  /**
   * Sorts agents by order field and filters to only enabled agents.
   * Returns a new array sorted in ascending order by the order field.
   *
   * @param agents - The agents array to sort
   * @returns Sorted array of enabled agents
   */
  sortAgentsByOrder(
    agents: AgentDefinitionCompiled[]
  ): AgentDefinitionCompiled[] {
    return agents
      .filter((agent) => agent.enabled !== false)
      .sort((a, b) => a.order - b.order);
  }
}
