// Central constants for the material extractor project

// Database table names - single source of truth
export const TABLE_NAMES = {
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
