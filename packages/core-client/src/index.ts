/**
 * Core Client Package
 *
 * Main entry point for the store-first client architecture.
 * Exports store configuration, actions, and types.
 *
 * Requirements: 16.3, 16.5
 */

// Export store functionality
export * from "./store";

// Export services
export * from "./services";

// Export repositories
export * from "./repositories";

// Export persistence service provider
export * from "./persistence";

// Export React hooks
export * from "./hooks";

// Note: Test utilities are NOT exported from the main package entry point.
// Import them directly from '@packages/core-client/test-utils' for testing.
