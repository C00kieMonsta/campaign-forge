import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLocalStorage } from "@/hooks/use-local-storage";
import AdminSidebar from "./AdminSidebar";

export default function AdminLayout() {
  const { isAuthenticated } = useAuth();
  // Persisted: on a laptop the Lex workspace wants every pixel, and re-collapsing the sidebar on
  // each page load would be an annoyance rather than a feature.
  const [collapsed, setCollapsed] = useLocalStorage(
    "admin_sidebar_collapsed",
    false
  );

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex min-h-screen">
      <AdminSidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
      />
      {/* Tighter padding when collapsed — the point of collapsing is content width. */}
      <main
        className={`flex-1 bg-background overflow-auto ${collapsed ? "px-5 py-6" : "p-8"}`}
      >
        <Outlet />
      </main>
    </div>
  );
}
