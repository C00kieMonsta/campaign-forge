// Prisma error codes - these are handled by Prisma client
export const PRISMA_ERROR_CODES = {
  UNIQUE_CONSTRAINT: "P2002",
  FOREIGN_KEY_CONSTRAINT: "P2003",
  RECORD_NOT_FOUND: "P2025",
  REQUIRED_FIELD_MISSING: "P2012"
} as const;

export const S3_ERROR_CODES = {
  NO_SUCH_KEY: "NoSuchKey",
  ACCESS_DENIED: "AccessDenied",
  BUCKET_NOT_FOUND: "NoSuchBucket"
} as const;

// Re-export consolidated status constants from @packages/types
export {
  ASYNC_JOB_STATUSES,
  ASYNC_JOB_STATUSES_VALUES,
  RESOURCE_STATUSES,
  RESOURCE_STATUSES_VALUES,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUSES_VALUES,
  AGENT_RESULT_STATUSES,
  AGENT_RESULT_STATUSES_VALUES
} from "@packages/types";
