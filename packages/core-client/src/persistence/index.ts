/**
 * Persistence Module
 *
 * Exports the PersistenceServiceProvider singleton and related types.
 * This module provides the main entry point for data access in the store-first architecture.
 *
 * Requirements: 9.5, 16.2, 16.3
 */

export {
  PersistenceServiceProvider,
  getPersistenceServiceProvider,
  type PersistenceServiceProviderConfig
} from "./persistence-service-provider";
