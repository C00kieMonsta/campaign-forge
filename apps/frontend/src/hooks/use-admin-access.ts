import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

/**
 * Hook to check if the current user has admin access
 *
 * For future optimization: Admin status could be stored in the Redux user entity
 * and derived from there instead of making a separate API call.
 */
export function useAdminAccess() {
  const [hasAdminAccess, setHasAdminAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAdminAccess = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Get auth token from Supabase session
        const supabase = getSupabaseBrowser();
        const {
          data: { session }
        } = await supabase.auth.getSession();
        const token = session?.access_token;

        const headers: Record<string, string> = {
          "Content-Type": "application/json"
        };

        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await fetch(
          `${import.meta.env.VITE_API_URL || ""}/api/auth/admin-access`,
          { headers }
        );

        if (response.status === 404 || response.status === 403) {
          setHasAdminAccess(false);
          return;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        setHasAdminAccess(data.hasAdminAccess ?? false);
      } catch (err) {
        console.warn("Failed to check admin access:", err);
        setHasAdminAccess(false);
        setError(
          err instanceof Error ? err.message : "Failed to check admin access"
        );
      } finally {
        setIsLoading(false);
      }
    };

    checkAdminAccess();
  }, []);

  return {
    data: { hasAdminAccess },
    isLoading,
    error,
    isSuccess: !error && !isLoading,
    isError: !!error
  };
}

/**
 * Simple hook that just returns boolean admin status
 * Useful for conditional rendering where you don't need the full hook info
 */
export function useIsAdmin(): boolean {
  const { data } = useAdminAccess();
  return data?.hasAdminAccess ?? false;
}
