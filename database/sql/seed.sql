-- =========================================
-- Reset & Seed: organization_members, users
-- =========================================

BEGIN;

-- 1) Empty tables (order doesn't matter with TRUNCATE + CASCADE)
TRUNCATE TABLE
  organization_members,
  users
RESTART IDENTITY CASCADE;

-- 2) Seed data for material-extractor production database

-- Create two users in the same organization
INSERT INTO users (id, email, first_name, last_name, timezone, meta, created_at, updated_at) VALUES
    ('2dc818b4-bfef-4618-a9a4-175a07275432', 'admin@remorai.solutions', 'Admin', 'User', 'UTC', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
ON CONFLICT (id) DO NOTHING;

-- Create organization membership for both users with Admin role
WITH default_org AS (
    SELECT id FROM organizations WHERE slug = 'remorai-labs'
),
admin_role AS (
    SELECT id FROM roles WHERE slug = 'admin' AND is_system = true AND organization_id IS NULL
)
INSERT INTO organization_members (id, organization_id, user_id, role_id, status, joined_at, created_at, updated_at)
SELECT 
    '00000000-0000-4000-8000-000000000030',
    default_org.id, 
    '2dc818b4-bfef-4618-a9a4-175a07275432',
    admin_role.id, 
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM default_org, admin_role
ON CONFLICT (organization_id, user_id) DO NOTHING;


-- Create default extraction schema for the organization
WITH default_org AS (
    SELECT id FROM organizations WHERE slug = 'remorai-labs'
)
INSERT INTO extraction_schemas (id, organization_id, name, version, definition, compiled_json_schema, created_at)
SELECT 
    '00000000-0000-4000-8000-000000000050',
    default_org.id,
    'default-material-extraction',
    1,
    '{
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "title": "Default Material Extraction Schema",
        "description": "Default schema for extracting material information from construction documents",
        "properties": {
            "itemCode": {
                "type": "string",
                "title": "Item Code",
                "description": "Unique identifier for the item",
                "importance": "high",
                "extractionInstructions": "Look for part numbers, SKUs, or item codes"
            },
            "itemName": {
                "type": "string",
                "title": "Item Name",
                "description": "Name or description of the item",
                "importance": "high",
                "extractionInstructions": "The main name or description of the material or component"
            },
            "technicalSpecifications": {
                "type": "string",
                "title": "Technical Specifications",
                "description": "Technical details and specifications",
                "importance": "medium",
                "extractionInstructions": "Technical specs, standards, grades, or detailed specifications"
            },
            "executionNotes": {
                "type": "string",
                "title": "Execution Notes",
                "description": "Notes about execution or installation",
                "importance": "low",
                "extractionInstructions": "Installation notes, execution requirements, or work instructions"
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
                "description": "Quantity of the item",
                "minimum": 0,
                "importance": "high",
                "extractionInstructions": "Numeric quantity, count, or amount"
            },
            "unit": {
                "type": "string",
                "title": "Unit",
                "description": "Unit for the quantity",
                "importance": "medium",
                "extractionInstructions": "Units like m, kg, pieces, etc."
            },
            "dimensions": {
                "type": "object",
                "title": "Dimensions",
                "description": "Physical dimensions of the item",
                "properties": {
                    "length": {"type": "number", "title": "Length"},
                    "width": {"type": "number", "title": "Width"},
                    "height": {"type": "number", "title": "Height"},
                    "diameter": {"type": "number", "title": "Diameter"},
                    "thickness": {"type": "number", "title": "Thickness"},
                    "radius": {"type": "number", "title": "Radius"},
                    "unit": {"type": "string", "title": "Dimension Unit"}
                }
            },
            "specifications": {
                "type": "object",
                "title": "Additional Specifications",
                "description": "Flexible specifications for any additional data",
                "additionalProperties": true
            }
        },
        "required": ["itemName"]
    }'::jsonb,
    '{
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "title": "Default Material Extraction Schema",
        "description": "Default schema for extracting material information from construction documents",
        "properties": {
            "itemCode": {
                "type": "string",
                "title": "Item Code",
                "description": "Unique identifier for the item",
                "importance": "high",
                "extractionInstructions": "Look for part numbers, SKUs, or item codes"
            },
            "itemName": {
                "type": "string",
                "title": "Item Name",
                "description": "Name or description of the item",
                "importance": "high",
                "extractionInstructions": "The main name or description of the material or component"
            },
            "technicalSpecifications": {
                "type": "string",
                "title": "Technical Specifications",
                "description": "Technical details and specifications",
                "importance": "medium",
                "extractionInstructions": "Technical specs, standards, grades, or detailed specifications"
            },
            "executionNotes": {
                "type": "string",
                "title": "Execution Notes",
                "description": "Notes about execution or installation",
                "importance": "low",
                "extractionInstructions": "Installation notes, execution requirements, or work instructions"
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
                "description": "Quantity of the item",
                "minimum": 0,
                "importance": "high",
                "extractionInstructions": "Numeric quantity, count, or amount"
            },
            "unit": {
                "type": "string",
                "title": "Unit",
                "description": "Unit for the quantity",
                "importance": "medium",
                "extractionInstructions": "Units like m, kg, pieces, etc."
            },
            "dimensions": {
                "type": "object",
                "title": "Dimensions",
                "description": "Physical dimensions of the item",
                "properties": {
                    "length": {"type": "number", "title": "Length"},
                    "width": {"type": "number", "title": "Width"},
                    "height": {"type": "number", "title": "Height"},
                    "diameter": {"type": "number", "title": "Diameter"},
                    "thickness": {"type": "number", "title": "Thickness"},
                    "radius": {"type": "number", "title": "Radius"},
                    "unit": {"type": "string", "title": "Dimension Unit"}
                }
            },
            "specifications": {
                "type": "object",
                "title": "Additional Specifications",
                "description": "Flexible specifications for any additional data",
                "additionalProperties": true
            }
        },
        "required": ["itemName"]
    }'::jsonb,
    CURRENT_TIMESTAMP
FROM default_org
ON CONFLICT (organization_id, name, version) DO NOTHING;

COMMIT;
