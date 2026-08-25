import { LogOut, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Language } from "@/i18n/translations";
import { useActiveApp } from "@/superapp/ActiveAppContext";
import { isNavItemActive } from "@/superapp/registry";
import AppSwitcher from "./AppSwitcher";

const languages: { value: Language; label: string }[] = [
  { value: "fr", label: "FR" },
  { value: "nl", label: "NL" }
];

const navItemClass = (isActive: boolean, collapsed: boolean) =>
  `flex items-center rounded-lg text-sm font-medium transition-colors ${
    collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
  } ${
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
  }`;

function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex bg-muted rounded-full p-0.5">
      {languages.map((lang) => (
        <button
          key={lang.value}
          onClick={() => setLanguage(lang.value)}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            language === lang.value
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The shell's one sidebar: brand, app switcher, then the nav of whichever app is active. Items that
 * belong to no single app (settings, language, logout) sit below the divider so switching apps
 * visibly changes only the middle section.
 *
 * Collapses to an icon rail. Every label becomes a `title` in that state, so nothing is
 * unreachable — collapsing trades discoverability for width, not function.
 */
export default function AdminSidebar({
  collapsed,
  onToggle,
  hideToggle = false
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** Inside the mobile sheet the sheet's own close button replaces the collapse toggle. */
  hideToggle?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { logout } = useAuth();
  const { app } = useActiveApp();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    // h-full (of AdminLayout's h-dvh row), not min-h-screen: the sidebar is chrome and belongs to
    // the viewport, not to the length of the page beside it. overflow-y-auto so its own nav scrolls
    // independently if it ever outgrows the screen, instead of pushing the layout taller.
    <aside
      className={`${collapsed ? "w-16" : "w-64"} shrink-0 h-full overflow-y-auto bg-sidebar text-sidebar-foreground flex flex-col transition-[width] duration-200`}
    >
      <div className={`pt-6 pb-4 space-y-2 ${collapsed ? "px-2" : "px-3"}`}>
        {!collapsed ? (
          <p className="px-3 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/40">
            Monique
          </p>
        ) : null}
        <div className="flex items-center gap-1">
          {collapsed ? null : (
            <div className="min-w-0 flex-1">
              <AppSwitcher />
            </div>
          )}
          {hideToggle ? null : (
            <button
              onClick={onToggle}
              title={collapsed ? t.nav.expandSidebar : t.nav.collapseSidebar}
              aria-label={
                collapsed ? t.nav.expandSidebar : t.nav.collapseSidebar
              }
              className={`shrink-0 rounded-lg p-2 text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground ${collapsed ? "mx-auto" : ""}`}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </button>
          )}
        </div>
      </div>

      <nav className={`flex-1 space-y-1 ${collapsed ? "px-2" : "px-3"}`}>
        {app.nav.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            title={collapsed ? item.label(t) : undefined}
            className={navItemClass(
              isNavItemActive(item, location.pathname),
              collapsed
            )}
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {collapsed ? null : item.label(t)}
          </Link>
        ))}
      </nav>

      <div
        className={`space-y-3 border-t border-sidebar-border ${collapsed ? "p-2" : "p-3"}`}
      >
        <Link
          to="/settings"
          title={collapsed ? t.settings.title : undefined}
          className={navItemClass(location.pathname === "/settings", collapsed)}
        >
          <Settings className="h-5 w-5 shrink-0" />
          {collapsed ? null : t.settings.title}
        </Link>
        {collapsed ? null : (
          <div className="flex justify-center">
            <LanguageSwitcher />
          </div>
        )}
        <button
          onClick={handleLogout}
          title={collapsed ? t.logout : undefined}
          className={`${navItemClass(false, collapsed)} w-full`}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {collapsed ? null : t.logout}
        </button>
      </div>
    </aside>
  );
}
