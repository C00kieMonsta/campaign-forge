import type { User } from "@packages/types";

/**
 * useCurrentUser
 *
 * Get the currently authenticated user from Redux store
 * Returns the user object if authenticated, null otherwise
 *
 * @example
 * const user = useCurrentUser();
 * console.log(user?.email);
 */
export function useCurrentUser(): User | null {
  // TODO: Get current user from state
  return null;
}
