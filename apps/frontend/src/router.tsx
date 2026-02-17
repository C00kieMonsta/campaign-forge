import { createBrowserRouter } from "react-router-dom";
import ProtectedRoute from "@/components/hoc/ProtectedRoute";
import AuthLayout from "@/layouts/AuthLayout";
import RootLayout from "@/layouts/RootLayout";
import CallbackPage from "@/pages/auth/CallbackPage";
import LoginPage from "@/pages/auth/LoginPage";
import RegisterPage from "@/pages/auth/RegisterPage";
import ResetPasswordPage from "@/pages/auth/ResetPasswordPage";
import VerifyEmailPage from "@/pages/auth/VerifyEmailPage";
import DashboardPage from "@/pages/DashboardPage";
import ExtractionPage from "@/pages/ExtractionPage";
// Page imports
import HomePage from "@/pages/HomePage";
import NotFoundPage from "@/pages/NotFoundPage";
import ProjectDetailPage from "@/pages/ProjectDetailPage";
import ProjectsPage from "@/pages/ProjectsPage";
import ClientsSettingsPage from "@/pages/settings/ClientsSettingsPage";
import OrganizationAuditLogsPage from "@/pages/settings/organization/audit-logs/OrganizationAuditLogsPage";
import EditSchemaPage from "@/pages/settings/organization/schemas/edit/EditSchemaPage";
import NewSchemaPage from "@/pages/settings/organization/schemas/new/NewSchemaPage";
import OrganizationSchemasPage from "@/pages/settings/organization/schemas/OrganizationSchemasPage";
import ViewSchemaPage from "@/pages/settings/organization/schemas/view/ViewSchemaPage";
import OrganizationMembersPage from "@/pages/settings/OrganizationMembersPage";
import OrganizationPage from "@/pages/settings/OrganizationPage";
import SuppliersSettingsPage from "@/pages/settings/SuppliersSettingsPage";
import SettingsPage from "@/pages/SettingsPage";

/**
 * React Router configuration
 *
 * Routes are organized as:
 * - Public routes (no auth required): auth, landing
 * - Protected routes (auth required): dashboard, projects, settings, etc.
 * - Catch-all: 404 page
 */
const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <NotFoundPage />,
    children: [
      // Public routes
      {
        index: true,
        element: <HomePage />
      },

      // Auth routes
      {
        path: "auth",
        element: <AuthLayout />,
        children: [
          {
            path: "login",
            element: <LoginPage />
          },
          {
            path: "register",
            element: <RegisterPage />
          },
          {
            path: "verify-email",
            element: <VerifyEmailPage />
          },
          {
            path: "callback",
            element: <CallbackPage />
          },
          {
            path: "reset-password",
            element: <ResetPasswordPage />
          }
        ]
      },

      // Protected routes
      {
        path: "dashboard",
        element: (
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        )
      },
      {
        path: "projects",
        element: (
          <ProtectedRoute>
            <ProjectsPage />
          </ProtectedRoute>
        )
      },
      {
        path: "projects/:projectId",
        element: (
          <ProtectedRoute>
            <ProjectDetailPage />
          </ProtectedRoute>
        )
      },
      {
        path: "extraction",
        element: (
          <ProtectedRoute>
            <ExtractionPage />
          </ProtectedRoute>
        )
      },
      // Settings routes
      {
        path: "settings",
        element: (
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        )
      },
      {
        path: "settings/organization",
        element: (
          <ProtectedRoute>
            <OrganizationPage />
          </ProtectedRoute>
        )
      },
      {
        path: "settings/organization/members",
        element: (
          <ProtectedRoute>
            <OrganizationMembersPage />
          </ProtectedRoute>
        )
      },
      {
        path: "settings/organization/audit-logs",
        element: (
          <ProtectedRoute>
            <OrganizationAuditLogsPage />
          </ProtectedRoute>
        )
      },
      {
        path: "settings/organization/schemas",
        element: (
          <ProtectedRoute>
            <OrganizationSchemasPage />
          </ProtectedRoute>
        )
      },
      {
        path: "settings/organization/schemas/new",
        element: (
          <ProtectedRoute>
            <NewSchemaPage />
          </ProtectedRoute>
        )
      },
      {
        path: "settings/organization/schemas/:schemaId/edit",
        element: (
          <ProtectedRoute>
            <EditSchemaPage />
          </ProtectedRoute>
        )
      },
      {
        path: "settings/organization/schemas/:schemaId/view",
        element: (
          <ProtectedRoute>
            <ViewSchemaPage />
          </ProtectedRoute>
        )
      },
      {
        path: "settings/clients",
        element: (
          <ProtectedRoute>
            <ClientsSettingsPage />
          </ProtectedRoute>
        )
      },
      {
        path: "settings/suppliers",
        element: (
          <ProtectedRoute>
            <SuppliersSettingsPage />
          </ProtectedRoute>
        )
      }
    ]
  },

  // Catch-all 404
  {
    path: "*",
    element: <NotFoundPage />
  }
]);

export default router;
