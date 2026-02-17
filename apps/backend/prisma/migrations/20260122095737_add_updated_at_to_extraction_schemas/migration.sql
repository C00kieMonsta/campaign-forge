/*
  Warnings:

  - Added the required column `updated_at` to the `extraction_schemas` table without a default value. This is not possible if the table is not empty.

*/
-- Temporarily drop the realtime trigger to avoid payload size issues during migration
DROP TRIGGER IF EXISTS t_extraction_schemas_notify ON extraction_schemas;

-- AlterTable: Add updated_at column
ALTER TABLE extraction_schemas ADD COLUMN updated_at TIMESTAMPTZ(6);

-- Set updated_at to created_at for existing rows
UPDATE extraction_schemas SET updated_at = created_at WHERE updated_at IS NULL;

-- Make the column NOT NULL after populating existing rows
ALTER TABLE extraction_schemas ALTER COLUMN updated_at SET NOT NULL;

-- Recreate the realtime trigger
CREATE TRIGGER t_extraction_schemas_notify
AFTER INSERT OR UPDATE OR DELETE ON extraction_schemas
FOR EACH ROW EXECUTE FUNCTION notify_row_change();
