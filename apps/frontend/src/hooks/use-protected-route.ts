import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";

/**
 * useProtectedRoute
 *
 * Hook to protect a page/component from unauthenticated access
 * Returns user and loading state, and redirects to login if needed
 *
 * Usage:
 * const { user, loading } = useProtectedRoute();
 */
export function useProtectedRoute() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth/login", { replace: true });
    }
  }, [user, loading, navigate]);

  return { user, loading };
}
