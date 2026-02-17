import { DashboardContent } from "@/components/dashboard/DashboardContent";
import { useProtectedRoute } from "@/hooks/use-protected-route";

/**
 * DashboardPage
 *
 * Main dashboard view showing user overview and key metrics
 */
export default function DashboardPage() {
  const { user, loading } = useProtectedRoute();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const firstName =
    (user.user_metadata?.first_name as string) ||
    user.email?.split("@")[0] ||
    "User";

  return (
    <div className="p-4">
      <div className="mx-auto">
        <div className="mb-6 lg:mb-8">
          <h1 className="text-2xl lg:text-3xl text-gray-900 dark:text-gray-100">
            <span className="font-bold">Welcome back, </span>
            {firstName}.
          </h1>
        </div>

        <DashboardContent />
      </div>
    </div>
  );
}
