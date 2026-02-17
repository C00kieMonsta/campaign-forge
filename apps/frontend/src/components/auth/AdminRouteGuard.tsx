import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle, Button } from "@packages/ui";
import { AlertTriangle, ShieldX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { PATHS } from "@/lib/paths";

interface AdminRouteGuardProps {
  children: React.ReactNode;
  fallbackPath?: string;
  showAccessDenied?: boolean;
}

/**
 * Route guard component that protects admin-only pages
 * Redirects non-admin users to fallback path or shows access denied message
 */
export function AdminRouteGuard({
  children,
  fallbackPath = `/${PATHS.SETTINGS}`,
  showAccessDenied = true
}: AdminRouteGuardProps) {
  const { data: adminAccess, isLoading, error } = useAdminAccess();
  const navigate = useNavigate();

  useEffect(() => {
    // Only redirect if we have a definitive answer and user is not admin
    if (!isLoading && !error && adminAccess && !adminAccess.hasAdminAccess) {
      if (!showAccessDenied) {
        navigate(fallbackPath, { replace: true });
      }
    }
  }, [adminAccess, isLoading, error, navigate, fallbackPath, showAccessDenied]);

  // Show loading state while checking permissions
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2 text-muted-foreground">
          Checking permissions...
        </span>
      </div>
    );
  }

  // Show error state if admin check failed
  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Permission Check Failed</AlertTitle>
          <AlertDescription>
            Unable to verify your access permissions. Please try refreshing the
            page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // If user is not admin, show access denied or redirect
  if (adminAccess && !adminAccess.hasAdminAccess) {
    if (showAccessDenied) {
      return (
        <div className="p-6 max-w-md mx-auto mt-8">
          <Alert variant="destructive">
            <ShieldX className="h-4 w-4" />
            <AlertTitle>Access Denied</AlertTitle>
            <AlertDescription className="mt-2">
              You need administrator privileges to access this page. Please
              contact your organization administrator if you believe this is an
              error.
            </AlertDescription>
          </Alert>
          <div className="mt-6 flex gap-3">
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
              className="flex-1"
            >
              Go Back
            </Button>
            <Button onClick={() => navigate(fallbackPath)} className="flex-1">
              Go to Settings
            </Button>
          </div>
        </div>
      );
    }
    // If showAccessDenied is false, the useEffect above will handle the redirect
    return null;
  }

  // If user has admin access, render the protected content
  return <>{children}</>;
}

/**
 * Higher-order component version for easier use with page components
 */
export function withAdminGuard<P extends object>(
  Component: React.ComponentType<P>,
  options?: Omit<AdminRouteGuardProps, "children">
) {
  return function AdminGuardedComponent(props: P) {
    return (
      <AdminRouteGuard {...options}>
        <Component {...props} />
      </AdminRouteGuard>
    );
  };
}
