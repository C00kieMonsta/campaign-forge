import { useCollection } from "@packages/core-client";
import type { ExtractionSchema } from "@packages/types";

/**
 * useExtractionSchemas
 *
 * Get all extraction schemas from Redux store
 * Data is fetched at the app level via useAppDataOrchestrator
 *
 * Returns array of extraction schemas (empty array if none)
 *
 * @example
 * const schemas = useExtractionSchemas();
 * const schema = schemas.find(s => s.id === "schema-123");
 */
export function useExtractionSchemas(): ExtractionSchema[] {
  return useCollection("extractionSchemas");
}
