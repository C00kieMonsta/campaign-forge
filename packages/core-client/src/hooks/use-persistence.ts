/**
 * usePersistence Hook
 *
 * Provides access to the PersistenceServiceProvider singleton from React components.
 * This is the main entry point for accessing repositories in the store-first architecture.
 *
 * Requirements: 3.4, 9.5, 12.1
 */

import { useMemo } from "react";
import {
  PersistenceServiceProvider,
  getPersistenceServiceProvider
} from "../persistence";

/**
 * Hook to access the PersistenceServiceProvider singleton.
 *
 * Returns the provider instance which gives access to all repositories.
 * The provider must be initialized before using this hook.
 *
 * @returns The PersistenceServiceProvider instance
 * @throws Error if PersistenceServiceProvider is not initialized
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const persistence = usePersistence();
 *
 *   const handleFetch = async () => {
 *     const clients = await persistence.clients.getAll();
 *     const projects = await persistence.projects.getAll();
 *   };
 *
 *   return <button onClick={handleFetch}>Fetch Data</button>;
 * }
 * ```
 *
 * Requirement 9.5: WHEN components need data access THEN the system SHALL use
 * getPersistenceServiceProvider() to access repositories
 *
 * Requirement 12.1: WHEN a component mounts THEN the system SHALL call
 * repository methods to fetch needed data
 */
export function usePersistence(): PersistenceServiceProvider {
  // Memoize to ensure stable reference across renders
  // The provider is a singleton, so this is safe
  return useMemo(() => {
    if (!PersistenceServiceProvider.isInitialized()) {
      throw new Error(
        "PersistenceServiceProvider not initialized. " +
          "Call PersistenceServiceProvider.initialize() in your app setup before using usePersistence()."
      );
    }
    return getPersistenceServiceProvider();
  }, []);
}
