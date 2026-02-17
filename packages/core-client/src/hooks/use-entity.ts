/**
 * useEntity Hook
 *
 * Hook for accessing a single entity by type and ID from the normalized store.
 * Re-renders only when the specific entity changes.
 *
 * Requirements: 10.2, 15.4, 21.2, 21.3
 */

import type {
  Client,
  ExtractionJob,
  ExtractionResult,
  ExtractionSchema,
  Invitation,
  OrganizationMember,
  Project,
  Supplier,
  SupplierMatch
} from "@packages/types";
import { useSelector } from "react-redux";
import type { RootState } from "../store";

/**
 * Entity type names that can be used with useEntity
 */
export type EntityType =
  | "clients"
  | "projects"
  | "extractionJobs"
  | "extractionResults"
  | "extractionSchemas"
  | "suppliers"
  | "organizationMembers"
  | "invitations"
  | "supplierMatches";

/**
 * Map entity type names to their corresponding entity types
 */
export type EntityTypeMap = {
  clients: Client;
  projects: Project;
  extractionJobs: ExtractionJob;
  extractionResults: ExtractionResult;
  extractionSchemas: ExtractionSchema;
  suppliers: Supplier;
  organizationMembers: OrganizationMember;
  invitations: Invitation;
  supplierMatches: SupplierMatch;
};

/**
 * Select a single entity from the store by type and ID.
 * Returns null if the entity is not found.
 *
 * @param type - The entity type (e.g., 'clients', 'projects')
 * @param id - The entity ID
 * @returns The entity or null if not found
 *
 * @example
 * const client = useEntity('clients', 'client-123');
 * if (client) {
 *   console.log(client.name);
 * }
 *
 * @example
 * const project = useEntity('projects', projectId);
 */
export function useEntity<T extends EntityType>(
  type: T,
  id: string | null | undefined
): EntityTypeMap[T] | null {
  return useSelector((state: RootState) => {
    if (!id) return null;
    const entities = state.entities[type] as Record<string, EntityTypeMap[T]>;
    return entities[id] || null;
  });
}
