-- Data Migration: Ensure all extraction schemas have agents field initialized
-- This script can be run safely multiple times (idempotent)
-- Run this after the schema migration 20251110194847_add_agents_support

-- Update any extraction_schemas that might have NULL agents field
-- (This should not be necessary if the migration ran correctly, but provides safety)
UPDATE extraction_schemas
SET agents = '[]'::jsonb
WHERE agents IS NULL;

-- Verify the migration
DO $$
DECLARE
    null_count INTEGER;
    total_count INTEGER;
BEGIN
    -- Count schemas with NULL agents
    SELECT COUNT(*) INTO null_count
    FROM extraction_schemas
    WHERE agents IS NULL;
    
    -- Count total schemas
    SELECT COUNT(*) INTO total_count
    FROM extraction_schemas;
    
    -- Log results
    RAISE NOTICE 'Data Migration Complete:';
    RAISE NOTICE '  Total schemas: %', total_count;
    RAISE NOTICE '  Schemas with NULL agents: %', null_count;
    RAISE NOTICE '  Schemas with agents field: %', total_count - null_count;
    
    -- Verify all schemas have agents field
    IF null_count > 0 THEN
        RAISE WARNING 'Found % schemas with NULL agents field. This should not happen.', null_count;
    ELSE
        RAISE NOTICE '✓ All schemas have agents field properly initialized';
    END IF;
END $$;

-- Add a comment to the agents column for documentation
COMMENT ON COLUMN extraction_schemas.agents IS 'Array of post-processing agent definitions (max 10). Each agent can transform, filter, or enrich extraction results.';

-- Verify the structure of the agents field for existing data
-- This query will show any schemas that have agents configured
SELECT 
    id,
    name,
    version,
    jsonb_array_length(agents) as agent_count,
    agents
FROM extraction_schemas
WHERE jsonb_array_length(agents) > 0;
