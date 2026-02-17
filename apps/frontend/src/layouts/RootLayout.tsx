import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, Toaster } from "@packages/ui";
import { NavigationComponent } from "@/components/navigation/NavigationComponent";

/**
 * RootLayout
 *
 * Main layout wrapper that handles:
 * - Navigation (sidebar + top bar)
 * - Toast notifications
 * - Layout structure
 *
 * Shows navigation for protected routes, hides for auth routes
 */
export default function RootLayout() {
  const location = useLocation();

  // List of paths that should not show the navigation
  const unprotectedRoutes = [
    "/auth/login",
    "/auth/register",
    "/auth/verify-email",
    "/auth/callback",
    "/auth/reset-password"
  ];

  const isUnprotectedRoute = unprotectedRoutes.some((route) =>
    location.pathname.startsWith(route)
  );

  // For unprotected routes, just render the page without navigation
  if (isUnprotectedRoute) {
    return (
      <>
        <Outlet />
        <Toaster />
      </>
    );
  }

  // For protected routes, wrap with navigation
  return (
    <SidebarProvider>
      <NavigationComponent>
        <main>
          <Outlet />
        </main>
      </NavigationComponent>
      <Toaster />
    </SidebarProvider>
  );
}
