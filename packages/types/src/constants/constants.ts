// Central constants for the material extractor project

// Database table names - single source of truth
export const TABLE_NAMES = {
  SUPPLIERS: "suppliers",
  SUPPLIER_MATCHES: "supplier_matches",

  // Core tables
  ORGANIZATIONS: "organizations",
  USERS: "users",
  ROLES: "roles",
  PERMISSIONS: "permissions",
  ROLE_PERMISSIONS: "role_permissions",
  ORGANIZATION_MEMBERS: "organization_members",

  // Business tables
  INVITATIONS: "invitations",
  CLIENTS: "clients",
  PROJECTS: "projects",
  DATA_LAYERS: "data_layers",

  // Processing tables
  EXTRACTION_JOBS: "extraction_jobs",
  EXTRACTION_RESULTS: "extraction_results",

  // System tables
  AUDIT_LOG: "audit_log"
} as const;

// Type for table names to ensure type safety
export type TableName = (typeof TABLE_NAMES)[keyof typeof TABLE_NAMES];

// Business logic constants
// Both enum forms (for named access) and array forms (for Zod schemas)

// ============================================================================
// CORE STATUS TYPES - Consolidated to 3 main categories
// ============================================================================

// 1. ASYNC_JOB_STATUSES - For all long-running async operations
//    Used by: extraction jobs, data layer processing, any background work
export const ASYNC_JOB_STATUSES = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled"
} as const;

export const ASYNC_JOB_STATUSES_VALUES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
] as const;

// 2. RESOURCE_STATUSES - For resource lifecycle management
//    Used by: projects, schemas, data layers, any long-lived resource
export const RESOURCE_STATUSES = {
  ACTIVE: "active",
  ARCHIVED: "archived",
  DELETED: "deleted"
} as const;

export const RESOURCE_STATUSES_VALUES = [
  "active",
  "archived",
  "deleted"
] as const;

// 3. VERIFICATION_STATUSES - For human verification workflows
//    Used by: extraction results, invitations, anything requiring approval
export const VERIFICATION_STATUSES = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected"
} as const;

export const VERIFICATION_STATUSES_VALUES = [
  "pending",
  "accepted",
  "rejected"
] as const;

// ============================================================================
// LEGACY ALIASES - Keep for backward compatibility during migration
// Deprecated: Use ASYNC_JOB_STATUSES, RESOURCE_STATUSES, or VERIFICATION_STATUSES
// ============================================================================

export const EXTRACTION_JOB_TYPES = {
  MATERIAL_EXTRACTION: "material_extraction",
  TEXT_EXTRACTION: "text_extraction",
  IMAGE_ANALYSIS: "image_analysis",
  DOCUMENT_PARSING: "document_parsing"
} as const;

export const EXTRACTION_JOB_TYPES_VALUES = [
  "material_extraction",
  "text_extraction",
  "image_analysis",
  "document_parsing"
] as const;

export const ROLE_SLUGS = {
  ADMIN: "admin",
  MEMBER: "member"
} as const;

export const PROPERTY_IMPORTANCE = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low"
} as const;

export const PROPERTY_IMPORTANCE_VALUES = ["high", "medium", "low"] as const;

// ============================================================================
// AGENT-SPECIFIC STATUSES - For LLM/Agent execution tracking
// ============================================================================

// AGENT_RESULT_STATUSES - Outcome of agent execution (success/failure modes)
// Consolidated from AGENT_EXECUTION_STATUSES and AGENT_METADATA_STATUSES
export const AGENT_RESULT_STATUSES = {
  SUCCESS: "success",
  FAILED: "failed",
  TIMEOUT: "timeout"
} as const;

export const AGENT_RESULT_STATUSES_VALUES = [
  "success",
  "failed",
  "timeout"
] as const;

// Agent execution failure modes - how/why the agent failed
export const AGENT_FAILURE_MODES = {
  BATCH_FAILURE: "batch_failure",
  INDIVIDUAL_FALLBACK: "individual_fallback",
  SKIP_ON_ERROR: "skip_on_error"
} as const;

export const AGENT_FAILURE_MODES_VALUES = [
  "batch_failure",
  "individual_fallback",
  "skip_on_error"
] as const;

// JSON Schema optimization constants
// Used by utilities and database services
export const JSON_SCHEMA_ESSENTIAL_FIELDS = [
  "$schema",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "oneOf",
  "allOf",
  "enum"
] as const;

export const JSON_SCHEMA_PROPERTY_FIELDS = [
  "type",
  "title",
  "description",
  "format",
  "items",
  "properties",
  "required"
] as const;

// Database limits for schema storage
export const MAX_SCHEMA_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_DESCRIPTION_LENGTH = 500;

export const UNIT_OPTIONS = [
  { value: "m", label: "m (meter)" },
  { value: "m²", label: "m² (square meter)" },
  { value: "m³", label: "m³ (cubic meter)" },
  { value: "kg", label: "kg (kilogram)" },
  { value: "t", label: "t (ton)" },
  { value: "St", label: "St (piece)" },
  { value: "Stk", label: "Stk (piece)" },
  { value: "l", label: "l (liter)" },
  { value: "h", label: "h (hour)" },
  { value: "cm", label: "cm (centimeter)" },
  { value: "mm", label: "mm (millimeter)" },
  { value: "km", label: "km (kilometer)" },
  { value: "g", label: "g (gram)" }
];
