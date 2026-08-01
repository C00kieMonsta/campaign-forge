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
    // h-screen, NOT min-h-screen. With min-h-screen this row grows to its CONTENT height, and two
    // things follow that both looked like separate bugs: the sidebar is a flex child under the
    // default align-items:stretch, so it stretched to that full content height and appeared to
    // "keep growing" down a long documents list; and <main> never overflowed, so its overflow-auto
    // never engaged, the DOCUMENT scrolled instead, and `position: sticky` inside main had no
    // scrollport to pin against (which is why the chronology's year rails never stuck).
    //
    // Fixed to the viewport, <main> becomes the scroll container: the sidebar stays put, sticky
    // works, and the two chat views' h-[calc(100vh-4rem)] finally means what it was written to mean.
    <div className="flex h-screen overflow-hidden">
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
