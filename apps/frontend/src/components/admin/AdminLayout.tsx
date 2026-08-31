import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@packages/ui";
import { Menu } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAppHeight } from "@/hooks/use-app-height";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useActiveApp } from "@/superapp/ActiveAppContext";
import AdminSidebar from "./AdminSidebar";

export default function AdminLayout() {
  const { isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const { app } = useActiveApp();
  const location = useLocation();
  // Persisted: on a laptop the Lex workspace wants every pixel, and re-collapsing the sidebar on
  // each page load would be an annoyance rather than a feature.
  const [collapsed, setCollapsed] = useLocalStorage(
    "admin_sidebar_collapsed",
    false
  );
  // Below md the sidebar is a sheet behind a hamburger — a fixed rail on a phone would leave the
  // content a sliver. Closed on navigation: tapping a nav link means "go there", not "keep the
  // menu over the page I asked for".
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Before the early return below. There is no react-hooks lint rule in this repo, so a hook placed
  // after it would simply crash on the login redirect.
  useAppHeight();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    // h-dvh, NOT min-h-screen. With min-h-screen this row grows to its CONTENT height, and two
    // things follow that both looked like separate bugs: the sidebar is a flex child under the
    // default align-items:stretch, so it stretched to that full content height and appeared to
    // "keep growing" down a long documents list; and <main> never overflowed, so its overflow-auto
    // never engaged, the DOCUMENT scrolled instead, and `position: sticky` inside main had no
    // scrollport to pin against (which is why the chronology's year rails never stuck).
    //
    // dvh rather than vh: on mobile Safari 100vh includes the space behind the URL bar, which put
    // the chat composer under it. Fixed to the visible viewport, <main> becomes the scroll
    // container: the sidebar stays put, sticky works, and the chat views' h-full means the screen.
    //
    // --app-height rather than dvh alone, because dvh tracks the URL bar and NOT the keyboard: iOS
    // treats the keyboard as an overlay, so a dvh shell kept its full height and the composer at its
    // bottom went behind the keys. See use-app-height. 100dvh stays as the fallback, so a browser
    // with no visualViewport behaves exactly as before.
    <div className="flex h-[var(--app-height,100dvh)] overflow-hidden">
      <div className="hidden md:block h-full">
        <AdminSidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((prev) => !prev)}
        />
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-64 gap-0 border-r-0 p-0">
          <SheetTitle className="sr-only">{t.nav.expandSidebar}</SheetTitle>
          <AdminSidebar
            collapsed={false}
            onToggle={() => setMobileNavOpen(false)}
            hideToggle
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="md:hidden flex items-center gap-2 border-b bg-sidebar px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-sidebar-foreground">
          <button
            onClick={() => setMobileNavOpen(true)}
            title={t.nav.expandSidebar}
            aria-label={t.nav.expandSidebar}
            className="rounded-lg p-2 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="truncate font-serif font-bold">{app.name(t)}</span>
        </header>
        {/* Tighter padding when collapsed — the point of collapsing is content width. */}
        {/* 8px of gutter on a phone, not 12: the chat needs the width, and the safe-area maxima
            keep the composer clear of the home indicator in landscape on a notched device. */}
        <main
          className={`flex-1 min-h-0 bg-background overflow-auto p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] sm:p-4 ${
            collapsed ? "md:px-5 md:py-6" : "md:p-8"
          }`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
