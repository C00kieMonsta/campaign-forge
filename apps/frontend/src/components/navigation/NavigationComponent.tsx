import { type ReactNode } from "react";
import { useSidebar } from "@packages/ui"; // Import useSidebar hook
import SideBarComponent from "@/components/navigation/side/SideBarComponent";
import TopBarComponent from "@/components/navigation/TopBarComponent";

type NavigationProps = {
  children: ReactNode;
};

export function NavigationComponent({ children }: NavigationProps) {
  const { state, isMobile } = useSidebar();

  const sidebarWidth = isMobile
    ? "0px"
    : state === "collapsed"
      ? "var(--sidebar-width-icon, 4rem)"
      : "var(--sidebar-width, 16rem)";

  return (
    <SideBarComponent>
      <div
        className="flex-grow w-full overflow-hidden"
        style={
          {
            "--sidebar-width-actual": sidebarWidth,
            maxWidth: "calc(100vw - var(--sidebar-width-actual))"
          } as React.CSSProperties
        }
      >
        <TopBarComponent />
        <div className="lg:pl-0 pl-0">{children}</div>
      </div>
    </SideBarComponent>
  );
}
