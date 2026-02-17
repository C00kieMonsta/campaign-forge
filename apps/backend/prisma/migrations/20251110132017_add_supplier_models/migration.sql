-- AlterTable
ALTER TABLE "supplier_matches" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "suppliers" ALTER COLUMN "id" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "extraction_schemas_organization_id_schema_identifier_version_ke" RENAME TO "extraction_schemas_organization_id_schema_identifier_versio_key";
