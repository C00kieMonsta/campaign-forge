// Core constants for campaign-forge

// Database table names
export const TABLE_NAMES = {
  CONTACTS: "contacts",
  CAMPAIGNS: "campaigns"
} as const;

// Type for table names
export type TableName = (typeof TABLE_NAMES)[keyof typeof TABLE_NAMES];

// Resource lifecycle statuses (used for projects, schemas, etc)
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
