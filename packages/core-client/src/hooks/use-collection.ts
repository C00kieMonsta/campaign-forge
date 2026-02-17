/**
 * useCollection Hook
 *
 * Hook for accessing filtered collections of entities from the normalized store.
 * Supports optional filtering via a predicate function.
 *
 * Requirements: 10.3, 15.4, 21.2, 21.3
 */

import { useMemo } from "react";
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
import { createSelector } from "@reduxjs/toolkit";
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import type { EntityType, EntityTypeMap } from "./use-entity";

/**
 * Filter function type for filtering entity collections
 */
export type EntityFilter<T> = (entity: T) => boolean;

/**
 * Select a collection of entities from the store by type.
 * Optionally filter the collection using a predicate function.
 *
 * Uses createSelector for proper memoization (Layer 2 defense):
 * - Selector result is cached and only recalculates when entities change
 * - Prevents component re-renders when array reference doesn't change
 *
 * @param type - The entity type (e.g., 'clients', 'projects')
 * @param filter - Optional filter function to apply to the collection
 * @returns Array of entities matching the filter (or all entities if no filter)
 *
 * @example
 * // Get all clients
 * const allClients = useCollection('clients');
 *
 * @example
 * // Get clients filtered by search term
 * const filteredClients = useCollection('clients', (client) =>
 *   client.name.toLowerCase().includes(searchTerm.toLowerCase())
 * );
 *
 * @example
 * // Get projects for a specific client
 * const clientProjects = useCollection('projects', (project) =>
 *   project.clientId === selectedClientId
 * );
 */
export function useCollection<T extends EntityType>(
  type: T,
  filter?: EntityFilter<EntityTypeMap[T]>
): EntityTypeMap[T][] {
  // Create memoized selector (Layer 2 defense)
  // Only recalculates when the entities record changes
  const selectEntities = useMemo(() => {
    return createSelector(
      [
        (state: RootState) =>
          state.entities[type] as Record<string, EntityTypeMap[T]>
      ],
      (entitiesRecord: Record<string, EntityTypeMap[T]>) => {
        const entities = Object.values(entitiesRecord);
        if (!filter) return entities;
        return entities.filter(filter);
      }
    );
  }, [type, filter]);

  // Use the memoized selector
  return useSelector(selectEntities);
}

/**
 * Select all clients from the store
 * @param filter - Optional filter function
 * @returns Array of client entities
 */
export function useClients(filter?: EntityFilter<Client>): Client[] {
  return useCollection("clients", filter);
}

/**
 * Select all projects from the store
 * @param filter - Optional filter function
 * @returns Array of project entities
 */
export function useProjects(filter?: EntityFilter<Project>): Project[] {
  return useCollection("projects", filter);
}

/**
 * Select all extraction jobs from the store
 * @param filter - Optional filter function
 * @returns Array of extraction job entities
 */
export function useExtractionJobs(
  filter?: EntityFilter<ExtractionJob>
): ExtractionJob[] {
  return useCollection("extractionJobs", filter);
}

/**
 * Select all extraction results from the store
 * @param filter - Optional filter function
 * @returns Array of extraction result entities
 */
export function useExtractionResults(
  filter?: EntityFilter<ExtractionResult>
): ExtractionResult[] {
  return useCollection("extractionResults", filter);
}

/**
 * Select all extraction schemas from the store
 * @param filter - Optional filter function
 * @returns Array of extraction schema entities
 */
export function useExtractionSchemas(
  filter?: EntityFilter<ExtractionSchema>
): ExtractionSchema[] {
  return useCollection("extractionSchemas", filter);
}

/**
 * Select all suppliers from the store
 * @param filter - Optional filter function
 * @returns Array of supplier entities
 */
export function useSuppliers(filter?: EntityFilter<Supplier>): Supplier[] {
  return useCollection("suppliers", filter);
}

/**
 * Select all organization members from the store
 * @param filter - Optional filter function
 * @returns Array of organization member entities
 */
export function useOrganizationMembers(
  filter?: EntityFilter<OrganizationMember>
): OrganizationMember[] {
  return useCollection("organizationMembers", filter);
}

/**
 * Select all invitations from the store
 * @param filter - Optional filter function
 * @returns Array of invitation entities
 */
export function useInvitations(
  filter?: EntityFilter<Invitation>
): Invitation[] {
  return useCollection("invitations", filter);
}

/**
 * Select all supplier matches from the store
 * @param filter - Optional filter function
 * @returns Array of supplier match entities
 */
export function useSupplierMatches(
  filter?: EntityFilter<SupplierMatch>
): SupplierMatch[] {
  return useCollection("supplierMatches", filter);
}
