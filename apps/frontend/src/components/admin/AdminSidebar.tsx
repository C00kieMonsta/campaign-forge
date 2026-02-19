import { Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Mail, LogOut, ChefHat, Tags } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import type { Language } from "@/i18n/translations";

const menuItems = [
  { path: "/dashboard", icon: LayoutDashboard, labelKey: "dashboard" as const },
  { path: "/contacts", icon: Users, labelKey: "contacts" as const },
  { path: "/groups", icon: Tags, labelKey: "groups" as const },
  { path: "/campaigns", icon: Mail, labelKey: "campaigns" as const },
];

const languages: { value: Language; label: string }[] = [
  { value: "fr", label: "FR" },
  { value: "nl", label: "NL" },
];

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

export default function AdminSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const menuLabels: Record<string, string> = {
    dashboard: t.dashboard.title,
    contacts: t.dashboard.contacts,
    groups: t.dashboard.groups,
    campaigns: t.dashboard.campaigns,
  };

  return (
    <aside className="w-64 shrink-0 min-h-screen bg-sidebar text-sidebar-foreground flex flex-col">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-2">
          <ChefHat className="h-8 w-8 text-sidebar-primary" />
          <div>
            <h1 className="text-lg font-serif font-bold">Monique</h1>
            <p className="text-xs text-sidebar-foreground/60">Admin Panel</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`}
            >
              <item.icon className="h-5 w-5" />
              {menuLabels[item.labelKey]}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 space-y-3 border-t border-sidebar-border">
        <div className="flex justify-center">
          <LanguageSwitcher />
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
        >
          <LogOut className="h-5 w-5" />
          {t.logout}
        </button>
      </div>
    </aside>
  );
}
