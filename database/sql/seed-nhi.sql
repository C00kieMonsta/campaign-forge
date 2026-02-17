-- =========================================
-- Reset & Seed: NHI - Naturstein organization
-- =========================================

BEGIN;

-- 1) Empty tables (order doesn't matter with TRUNCATE + CASCADE)
TRUNCATE TABLE
  organization_members,
  users,
  organizations
RESTART IDENTITY CASCADE;

-- 2) Create NHI - Naturstein organization
INSERT INTO organizations (id, name, slug, description, meta, created_at, updated_at) VALUES
    ('00000000-0000-4000-8000-000000000100', 'NHI - Naturstein', 'nhi-naturstein', 'Naturstein company specializing in construction materials', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (slug) DO NOTHING;

-- 3) Create user for NHI organization
INSERT INTO users (id, email, first_name, last_name, timezone, meta, created_at, updated_at) VALUES
    ('3dc818b4-bfef-4618-a9a4-175a07275433', 'eric.scheunemann@nhi-naturstein.de', 'Eric', 'Scheunemann', 'Europe/Berlin', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- 4) Create organization membership for Eric with Admin role
WITH nhi_org AS (
    SELECT id FROM organizations WHERE slug = 'nhi-naturstein'
),
admin_role AS (
    SELECT id FROM roles WHERE slug = 'admin' AND is_system = true AND organization_id IS NULL
)
INSERT INTO organization_members (id, organization_id, user_id, role_id, status, joined_at, created_at, updated_at)
SELECT 
    '00000000-0000-4000-8000-000000000130',
    nhi_org.id, 
    '3dc818b4-bfef-4618-a9a4-175a07275433',
    admin_role.id, 
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM nhi_org, admin_role
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- 5) Create default extraction schema for the NHI organization
WITH nhi_org AS (
    SELECT id FROM organizations WHERE slug = 'nhi-naturstein'
)
INSERT INTO extraction_schemas (id, organization_id, name, version, definition, compiled_json_schema, created_at)
SELECT 
    '00000000-0000-4000-8000-000000000150',
    nhi_org.id,
    'nhi-naturstein-material-extraction',
    1,
    '{
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "title": "NHI Naturstein Material Extraction Schema",
        "description": "Schema for extracting naturstein (natural stone) material information from construction documents",
        "properties": {
            "id": {
                "type": "string",
                "title": "ID",
                "description": "Optional identifier"
            },
            "itemCode": {
                "type": "string",
                "title": "Article Number / Item Code",
                "description": "Unique identifier for the stone material",
                "importance": "high",
                "extractionInstructions": "Look for article numbers, SKUs, or item codes for natural stone products"
            },
            "itemName": {
                "type": "string",
                "title": "Stone Type / Item Name",
                "description": "Name or description of the natural stone material",
                "importance": "high",
                "extractionInstructions": "The main name or description of the natural stone material (e.g., Granite, Marble, Limestone)"
            },
            "stoneOrigin": {
                "type": "string",
                "title": "Stone Origin",
                "description": "Quarry location or origin of the natural stone",
                "importance": "medium",
                "extractionInstructions": "Geographic origin or quarry location where the stone was extracted"
            },
            "stoneColor": {
                "type": "string",
                "title": "Stone Color",
                "description": "Color or color pattern of the stone",
                "importance": "medium",
                "extractionInstructions": "Main color or color variation description"
            },
            "stoneFinish": {
                "type": "string",
                "title": "Surface Finish",
                "description": "Surface treatment or finish of the stone",
                "importance": "medium",
                "extractionInstructions": "Surface finish like polished, honed, flamed, brushed, etc."
            },
            "technicalSpecifications": {
                "type": "string",
                "title": "Technical Specifications",
                "description": "Technical details and specifications for the stone",
                "importance": "medium",
                "extractionInstructions": "Technical specs, density, hardness, porosity, or other material properties"
            },
            "applications": {
                "type": "string",
                "title": "Applications",
                "description": "Recommended applications or use cases",
                "importance": "low",
                "extractionInstructions": "Intended use cases like flooring, cladding, countertops, etc."
            },
            "additionalNotes": {
                "type": "string",
                "title": "Additional Notes",
                "description": "Any additional information",
                "importance": "low"
            },
            "quantity": {
                "type": "number",
                "title": "Quantity",
                "description": "Quantity of the stone material",
                "minimum": 0,
                "importance": "high",
                "extractionInstructions": "Numeric quantity, count, or amount"
            },
            "unit": {
                "type": "string",
                "title": "Unit",
                "description": "Unit for the quantity",
                "importance": "medium",
                "extractionInstructions": "Units like m², m³, kg, pieces, slabs, etc."
            },
            "dimensions": {
                "type": "object",
                "title": "Dimensions",
                "description": "Physical dimensions of the stone material",
                "properties": {
                    "length": {"type": "number", "title": "Length (mm)"},
                    "width": {"type": "number", "title": "Width (mm)"},
                    "height": {"type": "number", "title": "Height/Thickness (mm)"},
                    "diameter": {"type": "number", "title": "Diameter (mm)"},
                    "thickness": {"type": "number", "title": "Thickness (mm)"},
                    "unit": {"type": "string", "title": "Dimension Unit", "default": "mm"}
                }
            },
            "pricePerUnit": {
                "type": "number",
                "title": "Price per Unit",
                "description": "Price per unit of the stone material",
                "minimum": 0,
                "importance": "medium",
                "extractionInstructions": "Unit price or cost per quantity unit"
            },
            "currency": {
                "type": "string",
                "title": "Currency",
                "description": "Currency for the price",
                "default": "EUR",
                "importance": "low"
            },
            "specifications": {
                "type": "object",
                "title": "Additional Specifications",
                "description": "Flexible specifications for any additional stone properties",
                "additionalProperties": true
            }
        },
        "required": ["itemName"]
    }'::jsonb,
    '{
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "title": "NHI Naturstein Material Extraction Schema",
        "description": "Schema for extracting naturstein (natural stone) material information from construction documents",
        "properties": {
            "id": {
                "type": "string",
                "title": "ID",
                "description": "Optional identifier"
            },
            "itemCode": {
                "type": "string",
                "title": "Article Number / Item Code",
                "description": "Unique identifier for the stone material",
                "importance": "high",
                "extractionInstructions": "Look for article numbers, SKUs, or item codes for natural stone products"
            },
            "itemName": {
                "type": "string",
                "title": "Stone Type / Item Name",
                "description": "Name or description of the natural stone material",
                "importance": "high",
                "extractionInstructions": "The main name or description of the natural stone material (e.g., Granite, Marble, Limestone)"
            },
            "stoneOrigin": {
                "type": "string",
                "title": "Stone Origin",
                "description": "Quarry location or origin of the natural stone",
                "importance": "medium",
                "extractionInstructions": "Geographic origin or quarry location where the stone was extracted"
            },
            "stoneColor": {
                "type": "string",
                "title": "Stone Color",
                "description": "Color or color pattern of the stone",
                "importance": "medium",
                "extractionInstructions": "Main color or color variation description"
            },
            "stoneFinish": {
                "type": "string",
                "title": "Surface Finish",
                "description": "Surface treatment or finish of the stone",
                "importance": "medium",
                "extractionInstructions": "Surface finish like polished, honed, flamed, brushed, etc."
            },
            "technicalSpecifications": {
                "type": "string",
                "title": "Technical Specifications",
                "description": "Technical details and specifications for the stone",
                "importance": "medium",
                "extractionInstructions": "Technical specs, density, hardness, porosity, or other material properties"
            },
            "applications": {
                "type": "string",
                "title": "Applications",
                "description": "Recommended applications or use cases",
                "importance": "low",
                "extractionInstructions": "Intended use cases like flooring, cladding, countertops, etc."
            },
            "additionalNotes": {
                "type": "string",
                "title": "Additional Notes",
                "description": "Any additional information",
                "importance": "low"
            },
            "quantity": {
                "type": "number",
                "title": "Quantity",
                "description": "Quantity of the stone material",
                "minimum": 0,
                "importance": "high",
                "extractionInstructions": "Numeric quantity, count, or amount"
            },
            "unit": {
                "type": "string",
                "title": "Unit",
                "description": "Unit for the quantity",
                "importance": "medium",
                "extractionInstructions": "Units like m², m³, kg, pieces, slabs, etc."
            },
            "dimensions": {
                "type": "object",
                "title": "Dimensions",
                "description": "Physical dimensions of the stone material",
                "properties": {
                    "length": {"type": "number", "title": "Length (mm)"},
                    "width": {"type": "number", "title": "Width (mm)"},
                    "height": {"type": "number", "title": "Height/Thickness (mm)"},
                    "diameter": {"type": "number", "title": "Diameter (mm)"},
                    "thickness": {"type": "number", "title": "Thickness (mm)"},
                    "unit": {"type": "string", "title": "Dimension Unit", "default": "mm"}
                }
            },
            "pricePerUnit": {
                "type": "number",
                "title": "Price per Unit",
                "description": "Price per unit of the stone material",
                "minimum": 0,
                "importance": "medium",
                "extractionInstructions": "Unit price or cost per quantity unit"
            },
            "currency": {
                "type": "string",
                "title": "Currency",
                "description": "Currency for the price",
                "default": "EUR",
                "importance": "low"
            },
            "specifications": {
                "type": "object",
                "title": "Additional Specifications",
                "description": "Flexible specifications for any additional stone properties",
                "additionalProperties": true
            }
        },
        "required": ["itemName"]
    }'::jsonb,
    CURRENT_TIMESTAMP
FROM nhi_org
ON CONFLICT (organization_id, name, version) DO NOTHING;

COMMIT;
