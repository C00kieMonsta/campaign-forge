// ============================================================================
// DEPRECATED: This package is being phased out in favor of @packages/types
// ============================================================================
//
// For new code, import directly from @packages/types:
//   import { Client, Project, ... } from "@packages/types"
//
// This file maintains backward compatibility by re-exporting from @packages/types
// ============================================================================

// Keep local utilities and helpers (not moved to types package)
export * from "./utils/helpers";
export {
  EVIDENCE_FIELDS,
  jsonSchemaToSchemaProperties,
  schemaPropertiesToJsonSchema,
  separateEvidenceFromExtraction
} from "./utils/extraction";
export { createDiagnosticLogger } from "./utils/diagnosticLogger";
