-- Drop the old unique constraint if it still exists
-- This constraint should have been dropped in a previous migration but may still exist
DROP INDEX IF EXISTS "extraction_schemas_organization_id_name_version_key";

-- Ensure the correct unique constraint exists (org + identifier + version)
-- Drop it first if it exists to avoid conflicts
DROP INDEX IF EXISTS "extraction_schemas_organization_id_schema_identifier_version_key";

-- Recreate the correct unique constraint
CREATE UNIQUE INDEX "extraction_schemas_organization_id_schema_identifier_version_key" 
ON "extraction_schemas"("organization_id", "schema_identifier", "version");

