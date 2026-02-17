import type { JsonSchemaDefinition, TSchemaProperty } from "../../types";
import {
  jsonSchemaToSchemaProperties,
  schemaPropertiesToJsonSchema
} from "../extraction";

describe("Schema Conversion Functions", () => {
  describe("schemaPropertiesToJsonSchema", () => {
    it("should preserve extractionInstructions, importance, and examples", () => {
      const properties: TSchemaProperty[] = [
        {
          name: "invoiceNumber",
          type: "string",
          title: "Invoice Number",
          description: "The unique invoice identifier",
          priority: "high",
          required: true,
          extractionInstructions:
            "Look for the invoice number at the top right",
          importance: "high",
          examples: [
            {
              id: "ex1",
              input: "Invoice #: INV-2024-001",
              output: "INV-2024-001"
            }
          ]
        }
      ];

      const jsonSchema = schemaPropertiesToJsonSchema(properties);

      expect(jsonSchema.properties.invoiceNumber).toMatchObject({
        type: "string",
        title: "Invoice Number",
        description: "The unique invoice identifier",
        importance: "high",
        extractionInstructions: "Look for the invoice number at the top right",
        displayName: "Invoice Number",
        examples: [
          {
            id: "ex1",
            input: "Invoice #: INV-2024-001",
            output: "INV-2024-001"
          }
        ]
      });
      expect(jsonSchema.required).toContain("invoiceNumber");
    });

    it("should handle properties without optional fields", () => {
      const properties: TSchemaProperty[] = [
        {
          name: "amount",
          type: "number",
          title: "Amount",
          description: "The total amount",
          priority: "medium",
          required: false
        }
      ];

      const jsonSchema = schemaPropertiesToJsonSchema(properties);

      expect(jsonSchema.properties.amount).toMatchObject({
        type: "number",
        title: "Amount",
        description: "The total amount",
        displayName: "Amount"
      });
      expect(
        jsonSchema.properties.amount.extractionInstructions
      ).toBeUndefined();
      expect(jsonSchema.properties.amount.importance).toBeUndefined();
      expect(jsonSchema.properties.amount.examples).toBeUndefined();
    });
  });

  describe("jsonSchemaToSchemaProperties", () => {
    it("should restore extractionInstructions, importance, and examples", () => {
      const jsonSchema: JsonSchemaDefinition = {
        type: "object",
        properties: {
          invoiceNumber: {
            type: "string",
            title: "Invoice Number",
            description: "The unique invoice identifier",
            importance: "high",
            extractionInstructions:
              "Look for the invoice number at the top right",
            examples: [
              {
                id: "ex1",
                input: "Invoice #: INV-2024-001",
                output: "INV-2024-001"
              }
            ]
          }
        },
        required: ["invoiceNumber"]
      };

      const properties = jsonSchemaToSchemaProperties(jsonSchema);

      expect(properties).toHaveLength(1);
      expect(properties[0]).toMatchObject({
        name: "invoiceNumber",
        type: "string",
        title: "Invoice Number",
        description: "The unique invoice identifier",
        priority: "high",
        required: true,
        extractionInstructions: "Look for the invoice number at the top right",
        importance: "high",
        examples: [
          {
            id: "ex1",
            input: "Invoice #: INV-2024-001",
            output: "INV-2024-001"
          }
        ]
      });
    });
  });

  describe("Round-trip conversion", () => {
    it("should preserve all fields through conversion cycle", () => {
      const originalProperties: TSchemaProperty[] = [
        {
          name: "itemCode",
          type: "string",
          title: "Item Code",
          description: "Product identifier",
          priority: "high",
          required: true,
          extractionInstructions: "Find the SKU or item code",
          importance: "high",
          examples: [
            { id: "1", input: "SKU: ABC123", output: "ABC123" },
            { id: "2", input: "Item: XYZ789", output: "XYZ789" }
          ]
        },
        {
          name: "quantity",
          type: "number",
          title: "Quantity",
          description: "Number of items",
          priority: "medium",
          required: false,
          extractionInstructions: "Look for qty or quantity field",
          importance: "medium"
        }
      ];

      const jsonSchema = schemaPropertiesToJsonSchema(originalProperties);
      const restoredProperties = jsonSchemaToSchemaProperties(jsonSchema);

      expect(restoredProperties).toHaveLength(2);
      expect(restoredProperties[0]).toMatchObject(originalProperties[0]);
      expect(restoredProperties[1]).toMatchObject(originalProperties[1]);
    });
  });
});
