/**
 * App-level hooks that read from Redux store
 *
 * These hooks provide a clean API for accessing data that's already
 * been fetched and stored in Redux by useAppDataOrchestrator.
 *
 * Pattern: All data fetching happens at app level, components read
 * from Redux using these hooks (store-first architecture).
 */

// Core data hooks
export { useCurrentUser } from "./useCurrentUser";
export { useCurrentOrganization } from "./useCurrentOrganization";
export { useProjects } from "./useProjects";
export { useExtractionJobs } from "./useExtractionJobs";
export { useExtractionJobsForProject } from "./useExtractionJobsForProject";
export { useExtractionSchemas } from "./useExtractionSchemas";

// Protection & auth hooks
export { useProtectedRoute } from "./use-protected-route";

// Admin access hook
export { useAdminAccess, useIsAdmin } from "./use-admin-access";

// File upload hook
export { useFileUpload } from "./use-file-upload";

// Audit logs hook
export { useAuditLogs } from "./use-audit-logs";
