import React from "react";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar
} from "@packages/ui";

// FooterMenu: improved UI, still generic (no user/org-specific logic)
const FooterMenu: React.FC = () => {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <SidebarFooter>
      <SidebarMenu>
        <SidebarSeparator />
        <SidebarMenuItem tabIndex={-1} className="pointer-events-none">
          <div
            className={`flex flex-col items-center w-full py-3 ${
              isCollapsed
                ? "opacity-0"
                : "opacity-60 hover:opacity-100 transition-opacity"
            }`}
          >
            {!isCollapsed && (
              <>
                <span className="text-xs text-muted-foreground tracking-wide font-light mb-2">
                  Powered by
                </span>
                <img
                  src="/logo_full_white.svg"
                  alt="Remorai"
                  className="h-6 w-auto"
                  style={{
                    filter:
                      "brightness(0) saturate(100%) invert(27%) sepia(51%) saturate(2878%) hue-rotate(258deg) brightness(104%) contrast(97%)"
                  }}
                />
              </>
            )}
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
};

export default FooterMenu;
