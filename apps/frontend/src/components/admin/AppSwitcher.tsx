import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@packages/ui";
import { Check, ChevronsUpDown } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveApp } from "@/superapp/ActiveAppContext";

/**
 * The app card at the top of the sidebar: shows the app you are in, and switches to another one.
 * Switching navigates to the target app's home rather than trying to map the current page across —
 * the apps share no page structure.
 */
export default function AppSwitcher() {
  const { app, apps, switchTo } = useActiveApp();
  const { t } = useLanguage();
  const ActiveIcon = app.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t.apps.switcher}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-sidebar-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent/50"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary/15 text-sidebar-primary">
          <ActiveIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-serif font-bold text-sidebar-foreground">
            {app.name(t)}
          </span>
          <span className="block truncate text-xs text-sidebar-foreground/60">
            {app.tagline(t)}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={6} className="w-[15rem]">
        {apps.map((entry) => {
          const EntryIcon = entry.icon;
          const isActive = entry.id === app.id;
          return (
            <DropdownMenuItem
              key={entry.id}
              onSelect={() => switchTo(entry.id)}
              className="gap-3 py-2"
            >
              <EntryIcon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {entry.name(t)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {entry.tagline(t)}
                </span>
              </span>
              {isActive && <Check className="h-4 w-4 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
