-- AlterTable
-- Make schema_identifier NOT NULL
ALTER TABLE "extraction_schemas" ALTER COLUMN "schema_identifier" SET NOT NULL;

-- DropIndex (old unique constraint already dropped in previous migration)

-- CreateIndex
-- Add new unique constraint (org + identifier + version)
CREATE UNIQUE INDEX "extraction_schemas_organization_id_schema_identifier_version_key" ON "extraction_schemas"("organization_id", "schema_identifier", "version");

