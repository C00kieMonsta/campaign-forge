/**
 * Tests for AI Schema Generation validation logic
 * These tests verify that the AI-generated schemas are properly validated
 * for date types, object lists, and nesting restrictions.
 */

// Mock the validation logic from CreateSchemaMenu
// Since we can't easily test the React component directly, we'll test the validation logic

interface AIGeneratedSchemaData {
  properties: SchemaProperty[];
  prompt: string;
  examples: Record<string, unknown>[];
}

// Extracted validation logic from CreateSchemaMenu
const validateProperty = (
  prop: Record<string, unknown>,
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
    const validItemTypes = ["string", "number", "boolean", "date", "object"];
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
      prop.fields.forEach((field: Record<string, unknown>) =>
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
    console.warn(`Property "${propPath}" is missing extractionInstructions.`);
  }

  // Examples are optional - just warn if missing
  if (!Array.isArray(prop.examples) || prop.examples.length === 0) {
    console.warn(
      `Property "${propPath}" is missing examples. Examples help improve extraction accuracy.`
    );
  } else {
    // Validate example structure if examples are provided
    prop.examples.forEach((ex: Record<string, unknown>, idx: number) => {
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

    parsed.properties.forEach((prop: Record<string, unknown>) =>
      validateProperty(prop)
    );

    return parsed as AIGeneratedSchemaData;
  } catch (error) {
    console.error("Error parsing AI response:", error);
    throw error;
  }
};

describe("AI Schema Generation Validation", () => {
  describe("Date Type Support", () => {
    it("should accept date type in AI-generated schema", () => {
      const schema = {
        properties: [
          {
            name: "invoiceDate",
            type: "date",
            title: "Invoice Date",
            description: "Date of invoice",
            priority: "high",
            required: true,
            extractionInstructions: "Extract the invoice date",
            importance: "high",
            examples: [
              {
                id: "ex1",
                input: "Invoice Date: 2024-01-15",
                output: "2024-01-15"
              }
            ]
          }
        ],
        prompt: "Extract invoice data",
        examples: []
      };

      const result = parseResponse(JSON.stringify(schema));

      expect(result.properties).toHaveLength(1);
      expect(result.properties[0].type).toBe("date");
      expect(result.properties[0].name).toBe("invoiceDate");
    });

    it("should accept list of dates in AI-generated schema", () => {
      const schema = {
        properties: [
          {
            name: "milestones",
            type: "list",
            itemType: "date",
            title: "Project Milestones",
            description: "Important dates",
            priority: "medium",
            required: false,
            extractionInstructions: "Extract milestone dates",
            importance: "medium",
            examples: [
              {
                id: "ex1",
                input: "Milestones: 2024-01-15, 2024-02-20",
                output: "2024-01-15"
              }
            ]
          }
        ],
        prompt: "Extract project data",
        examples: []
      };

      const result = parseResponse(JSON.stringify(schema));

      expect(result.properties[0].type).toBe("list");
      expect(result.properties[0].itemType).toBe("date");
    });

    it("should reject invalid date format in type field", () => {
      const schema = {
        properties: [
          {
            name: "invalidDate",
            type: "datetime", // Invalid type
            title: "Invalid Date",
            description: "Test",
            priority: "high",
            required: true,
            extractionInstructions: "Test",
            examples: [{ id: "ex1", input: "test", output: "test" }]
          }
        ],
        prompt: "Test",
        examples: []
      };

      expect(() => parseResponse(JSON.stringify(schema))).toThrow(
        'Property "invalidDate" has invalid type "datetime"'
      );
    });
  });

  describe("Object List Support", () => {
    it("should accept object lists with nested fields", () => {
      const schema = {
        properties: [
          {
            name: "lineItems",
            type: "list",
            itemType: "object",
            title: "Line Items",
            description: "Invoice items",
            priority: "high",
            required: true,
            extractionInstructions: "Extract all line items",
            importance: "high",
            examples: [
              {
                id: "ex1",
                input: "Item: MAT-001, Qty: 100",
                output: "test"
              }
            ],
            fields: [
              {
                name: "itemCode",
                type: "string",
                title: "Item Code",
                description: "Code",
                priority: "high",
                required: true,
                extractionInstructions: "Extract item code",
                importance: "high",
                examples: [{ id: "ex1", input: "MAT-001", output: "MAT-001" }]
              },
              {
                name: "quantity",
                type: "number",
                title: "Quantity",
                description: "Qty",
                priority: "high",
                required: true,
                extractionInstructions: "Extract quantity",
                importance: "high",
                examples: [{ id: "ex1", input: "100", output: "100" }]
              }
            ]
          }
        ],
        prompt: "Extract invoice data",
        examples: []
      };

      const result = parseResponse(JSON.stringify(schema));

      expect(result.properties[0].type).toBe("list");
      expect(result.properties[0].itemType).toBe("object");
      expect(result.properties[0].fields).toHaveLength(2);
      expect(result.properties[0].fields![0].name).toBe("itemCode");
      expect(result.properties[0].fields![1].name).toBe("quantity");
    });

    it("should accept object lists with date fields", () => {
      const schema = {
        properties: [
          {
            name: "materials",
            type: "list",
            itemType: "object",
            title: "Materials",
            description: "Material list",
            priority: "high",
            required: true,
            extractionInstructions: "Extract materials",
            importance: "high",
            examples: [
              {
                id: "ex1",
                input: "Material: Steel, Date: 2024-01-15",
                output: "test"
              }
            ],
            fields: [
              {
                name: "materialName",
                type: "string",
                title: "Material Name",
                description: "Name",
                priority: "high",
                required: true,
                extractionInstructions: "Extract name",
                importance: "high",
                examples: [{ id: "ex1", input: "Steel", output: "Steel" }]
              },
              {
                name: "deliveryDate",
                type: "date",
                title: "Delivery Date",
                description: "Date",
                priority: "medium",
                required: false,
                extractionInstructions: "Extract date",
                importance: "medium",
                examples: [
                  { id: "ex1", input: "2024-01-15", output: "2024-01-15" }
                ]
              }
            ]
          }
        ],
        prompt: "Extract material data",
        examples: []
      };

      const result = parseResponse(JSON.stringify(schema));

      expect(result.properties[0].fields).toHaveLength(2);
      expect(result.properties[0].fields![1].type).toBe("date");
    });

    it("should reject object lists without fields", () => {
      const schema = {
        properties: [
          {
            name: "items",
            type: "list",
            itemType: "object",
            title: "Items",
            description: "Test",
            priority: "high",
            required: true,
            extractionInstructions: "Test",
            examples: [{ id: "ex1", input: "test", output: "test" }],
            fields: [] // Empty fields array
          }
        ],
        prompt: "Test",
        examples: []
      };

      expect(() => parseResponse(JSON.stringify(schema))).toThrow(
        'Property "items" is a list of objects but has no fields defined'
      );
    });

    it("should reject list without itemType", () => {
      const schema = {
        properties: [
          {
            name: "items",
            type: "list",
            // Missing itemType
            title: "Items",
            description: "Test",
            priority: "high",
            required: true,
            extractionInstructions: "Test",
            examples: [{ id: "ex1", input: "test", output: "test" }]
          }
        ],
        prompt: "Test",
        examples: []
      };

      expect(() => parseResponse(JSON.stringify(schema))).toThrow(
        'Property "items" is a list but has invalid or missing itemType'
      );
    });
  });

  describe("Nesting Restrictions", () => {
    it("should reject nested object lists (lists within lists)", () => {
      const schema = {
        properties: [
          {
            name: "orders",
            type: "list",
            itemType: "object",
            title: "Orders",
            description: "Test",
            priority: "high",
            required: true,
            extractionInstructions: "Test",
            examples: [{ id: "ex1", input: "test", output: "test" }],
            fields: [
              {
                name: "items",
                type: "list",
                itemType: "object", // Nested object list - should fail
                title: "Items",
                description: "Test",
                priority: "high",
                required: true,
                extractionInstructions: "Test",
                examples: [{ id: "ex1", input: "test", output: "test" }],
                fields: [
                  {
                    name: "code",
                    type: "string",
                    title: "Code",
                    description: "Test",
                    priority: "high",
                    required: true,
                    extractionInstructions: "Test",
                    examples: [{ id: "ex1", input: "test", output: "test" }]
                  }
                ]
              }
            ]
          }
        ],
        prompt: "Test",
        examples: []
      };

      expect(() => parseResponse(JSON.stringify(schema))).toThrow(
        'Property "orders.items" is nested too deeply'
      );
    });

    it("should accept lists of primitives within object lists", () => {
      const schema = {
        properties: [
          {
            name: "products",
            type: "list",
            itemType: "object",
            title: "Products",
            description: "Test",
            priority: "high",
            required: true,
            extractionInstructions: "Test",
            examples: [{ id: "ex1", input: "test", output: "test" }],
            fields: [
              {
                name: "tags",
                type: "list",
                itemType: "string", // List of primitives is OK
                title: "Tags",
                description: "Test",
                priority: "low",
                required: false,
                extractionInstructions: "Test",
                examples: [{ id: "ex1", input: "test", output: "test" }]
              }
            ]
          }
        ],
        prompt: "Test",
        examples: []
      };

      const result = parseResponse(JSON.stringify(schema));

      expect(result.properties[0].fields![0].type).toBe("list");
      expect(result.properties[0].fields![0].itemType).toBe("string");
    });
  });

  describe("Example Validation", () => {
    it("should accept properties without examples (examples are optional)", () => {
      const schema = {
        properties: [
          {
            name: "field",
            type: "string",
            title: "Field",
            description: "Test",
            priority: "high",
            required: true,
            extractionInstructions: "Test",
            examples: [] // Empty examples - should be allowed
          }
        ],
        prompt: "Test",
        examples: []
      };

      // Should not throw - examples are optional
      const result = parseResponse(JSON.stringify(schema));
      expect(result.properties).toHaveLength(1);
      expect(result.properties[0].name).toBe("field");
    });

    it("should reject examples with missing id", () => {
      const schema = {
        properties: [
          {
            name: "field",
            type: "string",
            title: "Field",
            description: "Test",
            priority: "high",
            required: true,
            extractionInstructions: "Test",
            examples: [
              {
                // Missing id
                input: "test",
                output: "test"
              }
            ]
          }
        ],
        prompt: "Test",
        examples: []
      };

      expect(() => parseResponse(JSON.stringify(schema))).toThrow(
        'Property "field" example 1 is missing "id" field'
      );
    });

    it("should reject examples with missing input", () => {
      const schema = {
        properties: [
          {
            name: "field",
            type: "string",
            title: "Field",
            description: "Test",
            priority: "high",
            required: true,
            extractionInstructions: "Test",
            examples: [
              {
                id: "ex1",
                // Missing input
                output: "test"
              }
            ]
          }
        ],
        prompt: "Test",
        examples: []
      };

      expect(() => parseResponse(JSON.stringify(schema))).toThrow(
        'Property "field" example 1 is missing "input" field'
      );
    });

    it("should reject examples with missing output", () => {
      const schema = {
        properties: [
          {
            name: "field",
            type: "string",
            title: "Field",
            description: "Test",
            priority: "high",
            required: true,
            extractionInstructions: "Test",
            examples: [
              {
                id: "ex1",
                input: "test"
                // Missing output
              }
            ]
          }
        ],
        prompt: "Test",
        examples: []
      };

      expect(() => parseResponse(JSON.stringify(schema))).toThrow(
        'Property "field" example 1 is missing "output" field'
      );
    });
  });

  describe("Complex Schema Validation", () => {
    it("should accept complete schema with dates and object lists", () => {
      const schema = {
        properties: [
          {
            name: "invoiceNumber",
            type: "string",
            title: "Invoice Number",
            description: "Invoice ID",
            priority: "high",
            required: true,
            extractionInstructions: "Extract invoice number",
            importance: "high",
            examples: [{ id: "ex1", input: "INV-001", output: "INV-001" }]
          },
          {
            name: "invoiceDate",
            type: "date",
            title: "Invoice Date",
            description: "Date",
            priority: "high",
            required: true,
            extractionInstructions: "Extract date",
            importance: "high",
            examples: [{ id: "ex1", input: "2024-01-15", output: "2024-01-15" }]
          },
          {
            name: "lineItems",
            type: "list",
            itemType: "object",
            title: "Line Items",
            description: "Items",
            priority: "high",
            required: true,
            extractionInstructions: "Extract items",
            importance: "high",
            examples: [{ id: "ex1", input: "test", output: "test" }],
            fields: [
              {
                name: "code",
                type: "string",
                title: "Code",
                description: "Item code",
                priority: "high",
                required: true,
                extractionInstructions: "Extract code",
                importance: "high",
                examples: [{ id: "ex1", input: "MAT-001", output: "MAT-001" }]
              },
              {
                name: "quantity",
                type: "number",
                title: "Quantity",
                description: "Qty",
                priority: "high",
                required: true,
                extractionInstructions: "Extract qty",
                importance: "high",
                examples: [{ id: "ex1", input: "100", output: "100" }]
              },
              {
                name: "deliveryDate",
                type: "date",
                title: "Delivery Date",
                description: "Date",
                priority: "medium",
                required: false,
                extractionInstructions: "Extract date",
                importance: "medium",
                examples: [
                  { id: "ex1", input: "2024-02-01", output: "2024-02-01" }
                ]
              }
            ]
          }
        ],
        prompt: "Extract invoice data",
        examples: []
      };

      const result = parseResponse(JSON.stringify(schema));

      expect(result.properties).toHaveLength(3);
      expect(result.properties[0].type).toBe("string");
      expect(result.properties[1].type).toBe("date");
      expect(result.properties[2].type).toBe("list");
      expect(result.properties[2].itemType).toBe("object");
      expect(result.properties[2].fields).toHaveLength(3);
      expect(result.properties[2].fields![2].type).toBe("date");
    });
  });
});
