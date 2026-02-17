import { useNavigate } from "react-router-dom";
import { Button } from "@packages/ui";

/**
 * NotFoundPage
 *
 * 404 page when route doesn't exist
 */
export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900 mb-2">404</h1>
        <p className="text-xl text-gray-600 mb-6">Page not found</p>
        <Button onClick={() => navigate("/")} className="bg-blue-600">
          Go Home
        </Button>
      </div>
    </div>
  );
}
