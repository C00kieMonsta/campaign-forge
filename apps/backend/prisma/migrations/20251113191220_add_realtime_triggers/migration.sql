-- Create reusable notification function
-- This function builds JSON payloads and calls pg_notify() for database changes
CREATE OR REPLACE FUNCTION notify_row_change() 
RETURNS trigger AS $$
DECLARE
  payload jsonb;
BEGIN
  -- Build payload based on operation type
  IF (TG_OP = 'DELETE') THEN
    payload := jsonb_build_object(
      'op', 'DELETE',
      'table', TG_TABLE_NAME,
      'old', to_jsonb(OLD)
    );
  ELSE
    payload := jsonb_build_object(
      'op', TG_OP,
      'table', TG_TABLE_NAME,
      'new', to_jsonb(NEW)
    );
  END IF;
  
  -- Send notification on channel named after the table
  PERFORM pg_notify(TG_TABLE_NAME, payload::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- EXTRACTION JOBS TRIGGERS
-- ============================================================================
DROP TRIGGER IF EXISTS t_extraction_jobs_notify ON extraction_jobs;
CREATE TRIGGER t_extraction_jobs_notify
AFTER INSERT OR UPDATE OR DELETE ON extraction_jobs
FOR EACH ROW EXECUTE FUNCTION notify_row_change();

-- ============================================================================
-- PROJECTS TRIGGERS
-- ============================================================================
DROP TRIGGER IF EXISTS t_projects_notify ON projects;
CREATE TRIGGER t_projects_notify
AFTER INSERT OR UPDATE OR DELETE ON projects
FOR EACH ROW EXECUTE FUNCTION notify_row_change();

-- ============================================================================
-- EXTRACTION RESULTS TRIGGERS
-- ============================================================================
DROP TRIGGER IF EXISTS t_extraction_results_notify ON extraction_results;
CREATE TRIGGER t_extraction_results_notify
AFTER INSERT OR UPDATE OR DELETE ON extraction_results
FOR EACH ROW EXECUTE FUNCTION notify_row_change();

-- ============================================================================
-- DATA LAYERS TRIGGERS
-- ============================================================================
DROP TRIGGER IF EXISTS t_data_layers_notify ON data_layers;
CREATE TRIGGER t_data_layers_notify
AFTER INSERT OR UPDATE OR DELETE ON data_layers
FOR EACH ROW EXECUTE FUNCTION notify_row_change();

-- ============================================================================
-- SUPPLIER MATCHES TRIGGERS
-- ============================================================================
DROP TRIGGER IF EXISTS t_supplier_matches_notify ON supplier_matches;
CREATE TRIGGER t_supplier_matches_notify
AFTER INSERT OR UPDATE OR DELETE ON supplier_matches
FOR EACH ROW EXECUTE FUNCTION notify_row_change();
