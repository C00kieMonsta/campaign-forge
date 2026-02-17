import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem
} from "@packages/ui";
import { ChevronRight } from "lucide-react";

// Generic navigation menu props: no org/client-specific logic
interface NavigationMenuProps {
  navMain: Array<{
    title: string;
    icon: React.ComponentType;
    isActive: boolean;
    items: Array<{ title: string; url: string; icon?: React.ComponentType }>;
    url?: string;
    searchable?: boolean;
    collapsible?: boolean;
  }>;
}

const NavigationMenu: React.FC<NavigationMenuProps> = ({ navMain }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const [searchQuery, setSearchQuery] = useState("");

  // Filter items by search query
  const filterItems = (
    items: Array<{ title: string; url: string; icon?: React.ComponentType }>,
    query: string
  ) => {
    if (!query) return items;
    return items.filter((item) =>
      item.title.toLowerCase().includes(query.toLowerCase())
    );
  };

  return (
    <SidebarGroup>
      <SidebarMenu>
        {navMain.map((item) => {
          if (item.collapsible) {
            return (
              <Collapsible
                key={item.title}
                asChild
                defaultOpen={item.isActive}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip={item.title}
                      isActive={item.isActive}
                      className={`sidebar-menu-hover ${
                        item.isActive ? "sidebar-menu-active" : ""
                      }`}
                    >
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {item.searchable ? (
                      <div className="px-3 py-2">
                        <Input
                          type="search"
                          placeholder="Search..."
                          className="h-8"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                      </div>
                    ) : null}
                    <SidebarMenuSub className="max-h-[300px] overflow-y-auto">
                      {filterItems(item.items, searchQuery).map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={pathname === subItem.url}
                            className={`sidebar-menu-hover ${
                              pathname === subItem.url
                                ? "sidebar-menu-active"
                                : ""
                            }`}
                          >
                            <Button
                              variant="ghost"
                              onClick={() => navigate(subItem.url)}
                              className="w-full justify-start"
                            >
                              {subItem.icon && <subItem.icon />}
                              <span>{subItem.title}</span>
                            </Button>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            );
          } else {
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  asChild
                  isActive={item.isActive}
                  className={`sidebar-menu-hover ${
                    item.isActive ? "sidebar-menu-active" : ""
                  }`}
                >
                  <Button
                    variant="ghost"
                    onClick={() => navigate(item.url || "")}
                    className="w-full justify-start"
                  >
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                  </Button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          }
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
};

export default NavigationMenu;
