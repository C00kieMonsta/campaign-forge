-- AlterTable
ALTER TABLE "extraction_schemas" ADD COLUMN     "change_description" TEXT,
ADD COLUMN     "schema_identifier" TEXT;

-- Step 1: Generate identifiers for existing schemas
-- Schemas with same org+name get the same identifier (to preserve version groups)
WITH schema_groups AS (
  SELECT 
    "organization_id",
    "name",
    LOWER(SUBSTRING(MD5(RANDOM()::TEXT || "organization_id" || "name") FROM 1 FOR 12)) as identifier
  FROM "extraction_schemas"
  GROUP BY "organization_id", "name"
)
UPDATE "extraction_schemas" es
SET "schema_identifier" = sg.identifier
FROM schema_groups sg
WHERE es."organization_id" = sg."organization_id" 
  AND es."name" = sg."name";

-- Step 2: Drop old unique constraint
ALTER TABLE "extraction_schemas" DROP CONSTRAINT IF EXISTS "extraction_schemas_organization_id_name_version_key";

-- Step 3: Create index on schema_identifier
CREATE INDEX "extraction_schemas_schema_identifier_idx" ON "extraction_schemas"("schema_identifier");

-- Step 4: Add new unique constraint (org + identifier + version)
-- Note: Not adding the constraint yet because schema_identifier is nullable
-- Will be added in a follow-up step after making it non-null

