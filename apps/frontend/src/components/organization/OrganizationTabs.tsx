import { cn } from "@packages/ui";
import { Link, useLocation } from "react-router-dom";

interface Tab {
  label: string;
  href: string;
  value: string;
}

const tabs: Tab[] = [
  {
    label: "Members & Invitations",
    href: "/settings/organization/members",
    value: "members"
  },
  {
    label: "Schemas",
    href: "/settings/organization/schemas",
    value: "schemas"
  },
  {
    label: "Audit Logs",
    href: "/settings/organization/audit-logs",
    value: "audit-logs"
  }
];

export function OrganizationTabs() {
  const { pathname } = useLocation();

  const getActiveTab = () => {
    if (pathname?.includes("/schemas")) return "schemas";
    if (pathname?.includes("/audit-logs")) return "audit-logs";
    if (pathname?.includes("/members")) return "members";
    // Default to members if on the base organization page
    return "members";
  };

  const activeTab = getActiveTab();
  return (
    <div className="border-b border-gray-200">
      <nav className="-mb-px flex space-x-8" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.value;
          return (
            <Link
              key={tab.value}
              to={tab.href}
              className={cn(
                "whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
