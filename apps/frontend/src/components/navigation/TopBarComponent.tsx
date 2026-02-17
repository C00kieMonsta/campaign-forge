import { useState } from "react";
import { Button, cn, SidebarTrigger } from "@packages/ui";
import { FolderOpen, Home, Menu, Settings2, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { ClientSelector } from "@/components/navigation/ClientSelector";
// import { useIsAdmin } from "@/hooks/use-admin-access";
import { PATHS } from "@/lib/paths";

// Generic TopBarComponent: no org/user-specific logic
export default function TopBarComponent() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const pathname = location.pathname;

  const isActiveRoute = (url: string, exactMatch = false) => {
    if (!pathname) return false;
    if (exactMatch) return pathname === url;
    if (url === "/") return pathname === "/";
    return pathname.startsWith(url);
  };

  const navigationItems = [
    {
      title: "Home",
      url: "/",
      icon: Home,
      isActive: isActiveRoute("/", true)
    },
    {
      title: "Projects",
      url: `/${PATHS.PROJECTS}`,
      icon: FolderOpen,
      isActive: isActiveRoute(`/${PATHS.PROJECTS}`)
    },
    {
      title: "Settings",
      url: `/${PATHS.SETTINGS}`,
      icon: Settings2,
      isActive: isActiveRoute(`/${PATHS.SETTINGS}`)
    }
  ];

  return (
    <>
      <header className="flex h-16 shrink-0 items-center px-4 lg:h-8 lg:mt-2 lg:border-0">
        <div className="flex items-center gap-2 w-full justify-between lg:justify-start">
          {/* Desktop sidebar trigger */}
          <SidebarTrigger className="-ml-1 hidden lg:flex" />

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="h-6 w-6" />
          </Button>

          {/* Mobile app title */}
          <h1 className="text-lg font-semibold lg:hidden">
            Material Extractor
          </h1>
        </div>
      </header>

      {/* Mobile navigation overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed left-0 top-0 h-full w-64 bg-background border-r">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Material Extractor</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="p-4">
              <div className="mb-6">
                <ClientSelector />
              </div>

              <nav className="space-y-2">
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.url}
                      to={item.url}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                        item.isActive
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.title}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
