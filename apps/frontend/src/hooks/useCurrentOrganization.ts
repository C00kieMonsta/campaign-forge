import type { Organization } from "@packages/types";

/**
 * useCurrentOrganization
 *
 * Get the current organization from Redux store
 * Returns the organization object if user has one, null otherwise
 *
 * @example
 * const org = useCurrentOrganization();
 * console.log(org?.name);
 */
export function useCurrentOrganization(): Organization | null {
  // TODO: Get current organization from state
  return null;
}
