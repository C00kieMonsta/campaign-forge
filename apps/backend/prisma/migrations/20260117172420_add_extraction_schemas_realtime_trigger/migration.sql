-- ============================================================================
-- EXTRACTION SCHEMAS TRIGGERS
-- ============================================================================
DROP TRIGGER IF EXISTS t_extraction_schemas_notify ON extraction_schemas;
CREATE TRIGGER t_extraction_schemas_notify
AFTER INSERT OR UPDATE OR DELETE ON extraction_schemas
FOR EACH ROW EXECUTE FUNCTION notify_row_change();
