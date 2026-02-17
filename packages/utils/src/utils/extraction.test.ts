import type { JsonSchemaDefinition, TSchemaProperty } from "../types";
import {
  jsonSchemaToSchemaProperties,
  schemaPropertiesToJsonSchema
} from "./extraction";

describe("Schema Conversion Functions", () => {
  describe("Date Field Support", () => {
    it("should convert date type to JSON Schema with format: date", () => {
      const properties: TSchemaProperty[] = [
        {
          name: "invoiceDate",
          type: "date",
          title: "Invoice Date",
          description: "The date the invoice was issued",
          priority: "high",
          required: true,
          extractionInstructions: "Look for the invoice date near the top",
          importance: "high",
          examples: [
            {
              id: "ex1",
              input: "Invoice Date: January 15, 2024",
              output: "2024-01-15"
            }
          ]
        }
      ];

      const jsonSchema = schemaPropertiesToJsonSchema(properties);

      expect(jsonSchema.properties.invoiceDate).toEqual({
        type: "string",
        format: "date",
        title: "Invoice Date",
        description: "The date the invoice was issued",
        importance: "high",
        extractionInstructions: "Look for the invoice date near the top",
        displayName: "Invoice Date",
        order: 0,
        examples: [
          {
            id: "ex1",
            input: "Invoice Date: January 15, 2024",
            output: "2024-01-15"
          }
        ]
      });
      expect(jsonSchema.required).toContain("invoiceDate");
    });

    it("should convert JSON Schema with format: date to date type", () => {
      const jsonSchema: JsonSchemaDefinition = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        title: "Test Schema",
        description: "Test",
        properties: {
          deliveryDate: {
            type: "string",
            format: "date",
            title: "Delivery Date",
            description: "When the delivery occurred",
            importance: "high",
            extractionInstructions: "Find the delivery date",
            displayName: "Delivery Date",
            examples: [
              {
                id: "ex1",
                input: "Delivered on: 03/22/2024",
                output: "2024-03-22"
              }
            ]
          }
        },
        required: ["deliveryDate"]
      };

      const properties = jsonSchemaToSchemaProperties(jsonSchema);

      expect(properties).toHaveLength(1);
      expect(properties[0]).toEqual({
        name: "deliveryDate",
        type: "date",
        title: "Delivery Date",
        description: "When the delivery occurred",
        priority: "high",
        required: true,
        extractionInstructions: "Find the delivery date",
        importance: "high",
        examples: [
          {
            id: "ex1",
            input: "Delivered on: 03/22/2024",
            output: "2024-03-22"
          }
        ]
      });
    });

    it("should handle round-trip conversion for date fields", () => {
      const original: TSchemaProperty[] = [
        {
          name: "startDate",
          type: "date",
          title: "Start Date",
          description: "Project start date",
          priority: "medium",
          required: false,
          importance: "medium"
        }
      ];

      const jsonSchema = schemaPropertiesToJsonSchema(original);
      const converted = jsonSchemaToSchemaProperties(jsonSchema);

      expect(converted).toEqual(original);
    });
  });

  describe("Object List Support", () => {
    it("should convert object list to JSON Schema with nested properties", () => {
      const properties: TSchemaProperty[] = [
        {
          name: "lineItems",
          type: "list",
          itemType: "object",
          title: "Line Items",
          description: "Invoice line items",
          priority: "high",
          required: true,
          extractionInstructions: "Extract all line items from the table",
          importance: "high",
          examples: [
            {
              id: "ex1",
              input: "Item: MAT-001 | Desc: Steel Rebar | Qty: 100",
              output: JSON.stringify({
                itemCode: "MAT-001",
                description: "Steel Rebar",
                quantity: 100
              })
            }
          ],
          fields: [
            {
              name: "itemCode",
              type: "string",
              title: "Item Code",
              description: "Unique item identifier",
              priority: "high",
              required: true,
              importance: "high"
            },
            {
              name: "description",
              type: "string",
              title: "Description",
              description: "Item description",
              priority: "high",
              required: true,
              importance: "high"
            },
            {
              name: "quantity",
              type: "number",
              title: "Quantity",
              description: "Quantity ordered",
              priority: "high",
              required: true,
              importance: "high"
            }
          ]
        }
      ];

      const jsonSchema = schemaPropertiesToJsonSchema(properties);

      expect(jsonSchema.properties.lineItems).toEqual({
        type: "array",
        title: "Line Items",
        description: "Invoice line items",
        importance: "high",
        extractionInstructions: "Extract all line items from the table",
        displayName: "Line Items",
        order: 0,
        examples: [
          {
            id: "ex1",
            input: "Item: MAT-001 | Desc: Steel Rebar | Qty: 100",
            output: JSON.stringify({
              itemCode: "MAT-001",
              description: "Steel Rebar",
              quantity: 100
            })
          }
        ],
        items: {
          type: "object",
          properties: {
            itemCode: {
              type: "string",
              title: "Item Code",
              description: "Unique item identifier",
              importance: "high",
              extractionInstructions: undefined,
              displayName: "Item Code",
              order: 0,
              examples: undefined
            },
            description: {
              type: "string",
              title: "Description",
              description: "Item description",
              importance: "high",
              extractionInstructions: undefined,
              displayName: "Description",
              order: 0,
              examples: undefined
            },
            quantity: {
              type: "number",
              title: "Quantity",
              description: "Quantity ordered",
              importance: "high",
              extractionInstructions: undefined,
              displayName: "Quantity",
              order: 0,
              examples: undefined
            }
          },
          required: ["itemCode", "description", "quantity"]
        }
      });
      expect(jsonSchema.required).toContain("lineItems");
    });

    it("should convert JSON Schema with array of objects to object list", () => {
      const jsonSchema: JsonSchemaDefinition = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        title: "Test Schema",
        description: "Test",
        properties: {
          materials: {
            type: "array",
            title: "Materials",
            description: "List of materials",
            importance: "high",
            extractionInstructions: "Extract all materials",
            displayName: "Materials",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  title: "Material Name",
                  description: "Name of the material",
                  importance: "high"
                },
                quantity: {
                  type: "number",
                  title: "Quantity",
                  description: "Amount",
                  importance: "medium"
                },
                deliveryDate: {
                  type: "string",
                  format: "date",
                  title: "Delivery Date",
                  description: "When delivered",
                  importance: "medium"
                }
              },
              required: ["name", "quantity"]
            }
          }
        },
        required: ["materials"]
      };

      const properties = jsonSchemaToSchemaProperties(jsonSchema);

      expect(properties).toHaveLength(1);
      expect(properties[0].name).toBe("materials");
      expect(properties[0].type).toBe("list");
      expect(properties[0].itemType).toBe("object");
      expect(properties[0].fields).toHaveLength(3);

      const fields = properties[0].fields!;
      expect(fields[0]).toEqual({
        name: "name",
        type: "string",
        title: "Material Name",
        description: "Name of the material",
        priority: "high",
        required: true,
        extractionInstructions: undefined,
        importance: "high",
        examples: undefined
      });

      expect(fields[1]).toEqual({
        name: "quantity",
        type: "number",
        title: "Quantity",
        description: "Amount",
        priority: "medium",
        required: true,
        extractionInstructions: undefined,
        importance: "medium",
        examples: undefined
      });

      expect(fields[2]).toEqual({
        name: "deliveryDate",
        type: "date",
        title: "Delivery Date",
        description: "When delivered",
        priority: "medium",
        required: false,
        extractionInstructions: undefined,
        importance: "medium",
        examples: undefined
      });
    });

    it("should handle round-trip conversion for object lists", () => {
      const original: TSchemaProperty[] = [
        {
          name: "items",
          type: "list",
          itemType: "object",
          title: "Items",
          description: "List of items",
          priority: "high",
          required: true,
          importance: "high",
          fields: [
            {
              name: "code",
              type: "string",
              title: "Code",
              description: "Item code",
              priority: "high",
              required: true,
              importance: "high"
            },
            {
              name: "price",
              type: "number",
              title: "Price",
              description: "Item price",
              priority: "medium",
              required: false,
              importance: "medium"
            }
          ]
        }
      ];

      const jsonSchema = schemaPropertiesToJsonSchema(original);
      const converted = jsonSchemaToSchemaProperties(jsonSchema);

      expect(converted).toEqual(original);
    });
  });

  describe("List of Primitives with Date Support", () => {
    it("should convert list of dates to JSON Schema", () => {
      const properties: TSchemaProperty[] = [
        {
          name: "milestones",
          type: "list",
          itemType: "date",
          title: "Project Milestones",
          description: "Important dates",
          priority: "medium",
          required: false,
          importance: "medium"
        }
      ];

      const jsonSchema = schemaPropertiesToJsonSchema(properties);

      expect(jsonSchema.properties.milestones).toEqual({
        type: "array",
        title: "Project Milestones",
        description: "Important dates",
        importance: "medium",
        extractionInstructions: undefined,
        displayName: "Project Milestones",
        order: 0,
        examples: undefined,
        items: {
          type: "string",
          format: "date"
        }
      });
    });

    it("should convert JSON Schema array with date items to list of dates", () => {
      const jsonSchema: JsonSchemaDefinition = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        title: "Test Schema",
        description: "Test",
        properties: {
          dates: {
            type: "array",
            title: "Important Dates",
            description: "Key dates",
            importance: "low",
            items: {
              type: "string",
              format: "date"
            }
          }
        },
        required: []
      };

      const properties = jsonSchemaToSchemaProperties(jsonSchema);

      expect(properties).toHaveLength(1);
      expect(properties[0]).toEqual({
        name: "dates",
        type: "list",
        itemType: "date",
        title: "Important Dates",
        description: "Key dates",
        priority: "low",
        required: false,
        extractionInstructions: undefined,
        importance: "low",
        examples: undefined
      });
    });
  });

  describe("Complex Schema with Multiple Types", () => {
    it("should handle schema with dates, primitives, and object lists", () => {
      const properties: TSchemaProperty[] = [
        {
          name: "invoiceNumber",
          type: "string",
          title: "Invoice Number",
          description: "Unique invoice identifier",
          priority: "high",
          required: true,
          importance: "high"
        },
        {
          name: "invoiceDate",
          type: "date",
          title: "Invoice Date",
          description: "Date of invoice",
          priority: "high",
          required: true,
          importance: "high"
        },
        {
          name: "totalAmount",
          type: "number",
          title: "Total Amount",
          description: "Total invoice amount",
          priority: "high",
          required: true,
          importance: "high"
        },
        {
          name: "lineItems",
          type: "list",
          itemType: "object",
          title: "Line Items",
          description: "Invoice items",
          priority: "high",
          required: true,
          importance: "high",
          fields: [
            {
              name: "description",
              type: "string",
              title: "Description",
              description: "Item description",
              priority: "high",
              required: true,
              importance: "high"
            },
            {
              name: "quantity",
              type: "number",
              title: "Quantity",
              description: "Item quantity",
              priority: "high",
              required: true,
              importance: "high"
            },
            {
              name: "deliveryDate",
              type: "date",
              title: "Delivery Date",
              description: "Expected delivery",
              priority: "medium",
              required: false,
              importance: "medium"
            }
          ]
        }
      ];

      const jsonSchema = schemaPropertiesToJsonSchema(properties);
      const converted = jsonSchemaToSchemaProperties(jsonSchema);

      expect(converted).toEqual(properties);
      expect(jsonSchema.properties.invoiceDate.format).toBe("date");
      expect(jsonSchema.properties.lineItems.items?.type).toBe("object");
      expect(
        jsonSchema.properties.lineItems.items?.properties?.deliveryDate.format
      ).toBe("date");
    });
  });

  describe("Property Ordering", () => {
    it("should preserve property order when converting to JSON Schema", () => {
      const properties: TSchemaProperty[] = [
        {
          name: "fieldC",
          type: "string",
          title: "Field C",
          description: "Third field",
          priority: "medium",
          required: false
        },
        {
          name: "fieldA",
          type: "string",
          title: "Field A",
          description: "First field",
          priority: "high",
          required: true
        },
        {
          name: "fieldB",
          type: "number",
          title: "Field B",
          description: "Second field",
          priority: "medium",
          required: false
        }
      ];

      const jsonSchema = schemaPropertiesToJsonSchema(properties);

      // Check that order is set correctly based on array position
      expect(jsonSchema.properties.fieldC.order).toBe(0);
      expect(jsonSchema.properties.fieldA.order).toBe(1);
      expect(jsonSchema.properties.fieldB.order).toBe(2);
    });

    it("should restore property order when converting from JSON Schema", () => {
      const jsonSchema: JsonSchemaDefinition = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        title: "Test Schema",
        description: "Test",
        properties: {
          fieldC: {
            type: "string",
            title: "Field C",
            description: "Third field",
            importance: "medium",
            order: 2
          },
          fieldA: {
            type: "string",
            title: "Field A",
            description: "First field",
            importance: "high",
            order: 0
          },
          fieldB: {
            type: "number",
            title: "Field B",
            description: "Second field",
            importance: "medium",
            order: 1
          }
        },
        required: ["fieldA"]
      };

      const properties = jsonSchemaToSchemaProperties(jsonSchema);

      // Properties should be ordered by their order field
      expect(properties[0].name).toBe("fieldA");
      expect(properties[1].name).toBe("fieldB");
      expect(properties[2].name).toBe("fieldC");
    });

    it("should handle properties without order field", () => {
      const jsonSchema: JsonSchemaDefinition = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        title: "Test Schema",
        description: "Test",
        properties: {
          fieldWithOrder: {
            type: "string",
            title: "Field With Order",
            description: "Has order",
            order: 0
          },
          fieldWithoutOrder: {
            type: "string",
            title: "Field Without Order",
            description: "No order"
          }
        }
      };

      const properties = jsonSchemaToSchemaProperties(jsonSchema);

      // Field with order should come first
      expect(properties[0].name).toBe("fieldWithOrder");
      expect(properties[1].name).toBe("fieldWithoutOrder");
    });
  });
});
