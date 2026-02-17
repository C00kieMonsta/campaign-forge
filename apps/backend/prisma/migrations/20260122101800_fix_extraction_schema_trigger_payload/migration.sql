-- Fix the extraction_schemas trigger to avoid "payload string too long" error
-- by sending only essential fields instead of the entire schema object

-- Drop the existing trigger
DROP TRIGGER IF EXISTS t_extraction_schemas_notify ON extraction_schemas;

-- Create a specialized notification function for extraction schemas
CREATE OR REPLACE FUNCTION notify_extraction_schema_change()
RETURNS trigger AS $$
DECLARE
  payload jsonb;
BEGIN
  -- Build minimal payload to avoid size limits
  IF (TG_OP = 'DELETE') THEN
    payload := jsonb_build_object(
      'op', 'DELETE',
      'table', TG_TABLE_NAME,
      'old', jsonb_build_object(
        'id', OLD.id,
        'organizationId', OLD.organization_id,
        'schemaIdentifier', OLD.schema_identifier,
        'name', OLD.name,
        'version', OLD.version
      )
    );
  ELSE
    payload := jsonb_build_object(
      'op', TG_OP,
      'table', TG_TABLE_NAME,
      'new', jsonb_build_object(
        'id', NEW.id,
        'organizationId', NEW.organization_id,
        'schemaIdentifier', NEW.schema_identifier,
        'name', NEW.name,
        'version', NEW.version,
        'createdAt', NEW.created_at,
        'updatedAt', NEW.updated_at
      )
    );
  END IF;
  
  -- Send notification on channel named after the table
  PERFORM pg_notify(TG_TABLE_NAME, payload::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger using the specialized function
CREATE TRIGGER t_extraction_schemas_notify
AFTER INSERT OR UPDATE OR DELETE ON extraction_schemas
FOR EACH ROW EXECUTE FUNCTION notify_extraction_schema_change();
