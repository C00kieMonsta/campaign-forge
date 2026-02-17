import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";

/**
 * HomePage
 *
 * Redirects authenticated users to dashboard, unauthenticated to login
 */
export default function HomePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      if (user) {
        navigate("/dashboard", { replace: true });
      } else {
        navigate("/auth/login", { replace: true });
      }
    }
  }, [user, loading, navigate]);

  return null;
}
