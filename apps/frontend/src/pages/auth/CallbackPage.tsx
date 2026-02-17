import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

/**
 * CallbackPage
 *
 * OAuth callback page
 * Handles Supabase auth callback after magic link or OAuth login
 */
export default function CallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get the code from URL
        const code = searchParams.get("code");
        if (!code) {
          console.log("No code in callback");
          navigate("/auth/login");
          return;
        }

        // Exchange code for session
        const supabase = getSupabaseBrowser();
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          console.error("Callback error:", error);
          navigate("/auth/login");
          return;
        }

        // Redirect to dashboard
        navigate("/", { replace: true });
      } catch (error) {
        console.error("Callback processing error:", error);
        navigate("/auth/login");
      }
    };

    handleCallback();
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <p className="text-gray-600">Processing authentication...</p>
      </div>
    </div>
  );
}
