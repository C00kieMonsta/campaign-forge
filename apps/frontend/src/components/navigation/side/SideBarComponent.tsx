import React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset
} from "@packages/ui";
import {
  Building2,
  FolderOpen,
  HomeIcon,
  Settings2,
  User,
  Users
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { ClientSelector } from "@/components/navigation/ClientSelector";
import FooterMenu from "@/components/navigation/side/FooterMenu";
import NavigationMenu from "@/components/navigation/side/NavigationMenu";
import SecondaryMenu from "@/components/navigation/side/SecondaryMenu";
import { useIsAdmin } from "@/hooks/use-admin-access";
import { PATHS } from "@/lib/paths";

const SideBarComponent: React.FC<React.PropsWithChildren<unknown>> = ({
  children
}) => {
  const { pathname } = useLocation();
  const isAdmin = useIsAdmin();

  // Helper function to determine if a navigation item is active
  const isActiveRoute = (url: string, exactMatch = false) => {
    if (!pathname) return false;
    if (exactMatch) return pathname === url;
    if (url === "/") return pathname === "/";
    return pathname.startsWith(url);
  };

  // Build Settings menu items conditionally based on admin access
  const settingsItems = [
    {
      title: "Profile",
      url: `/${PATHS.SETTINGS}`,
      icon: User
    }
  ];

  // Add admin-only menu items
  if (isAdmin) {
    settingsItems.push(
      {
        title: "Organization",
        url: `/${PATHS.SETTINGS}/organization/members`,
        icon: Users
      },
      {
        title: "Clients",
        url: `/${PATHS.SETTINGS}/clients`,
        icon: Building2
      },
      {
        title: "Suppliers",
        url: `/${PATHS.SETTINGS}/suppliers`,
        icon: Users
      }
    );
  }

  // Generic navigation, no org/client context
  const navMain = [
    {
      title: "Home",
      url: "/dashboard",
      icon: HomeIcon,
      isActive: isActiveRoute("/", true),
      searchable: false,
      collapsible: false,
      items: []
    },
    {
      title: "Projects",
      url: `/${PATHS.PROJECTS}`,
      icon: FolderOpen,
      isActive: isActiveRoute(`/${PATHS.PROJECTS}`),
      searchable: false,
      collapsible: false,
      items: []
    },
    {
      title: "Settings",
      url: `/${PATHS.SETTINGS}`,
      icon: Settings2,
      isActive: isActiveRoute(`/${PATHS.SETTINGS}`),
      searchable: false,
      collapsible: true,
      items: settingsItems
    }
  ];

  return (
    <>
      <Sidebar
        collapsible="icon"
        variant="inset"
        className="lg:flex hidden p-0 h-screen max-h-screen"
      >
        <SidebarHeader>
          <ClientSelector />
        </SidebarHeader>
        <SidebarContent className="flex-1 overflow-y-auto">
          <NavigationMenu navMain={navMain} />
          <SecondaryMenu />
        </SidebarContent>
        <FooterMenu />
      </Sidebar>
      <SidebarInset className="lg:ml-0 ml-0">{children}</SidebarInset>
    </>
  );
};

export default SideBarComponent;
