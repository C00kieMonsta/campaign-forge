import {
  FileText,
  Landmark,
  LayoutDashboard,
  Mail,
  Scale,
  Tags,
  Users,
  type LucideIcon
} from "lucide-react";
import type { translations } from "@/i18n/translations";

type Translation = typeof translations.fr;

export type AppId = "lex" | "campaigns";

export interface AppNavItem {
  path: string;
  icon: LucideIcon;
  label: (t: Translation) => string;
  /**
   * Match `path` exactly rather than as a prefix. Needed for an app's index route, which is a
   * prefix of every other route in that app and would otherwise always look active.
   */
  exact?: boolean;
}

export interface SuperApp {
  id: AppId;
  /** Every route of this app lives under this prefix, which is also the app's home. */
  basePath: string;
  icon: LucideIcon;
  name: (t: Translation) => string;
  tagline: (t: Translation) => string;
  nav: AppNavItem[];
}

/**
 * The apps hosted by the Command Center shell. Order is the order shown in the app switcher;
 * the first entry is the default for a browser that has never picked one.
 *
 * Adding an app means adding an entry here plus its route subtree in App.tsx — the sidebar,
 * switcher, and "which app am I in?" resolution all derive from this list.
 */
export const APPS: SuperApp[] = [
  {
    id: "lex",
    basePath: "/lex",
    icon: Scale,
    name: (t) => t.apps.lex.name,
    tagline: (t) => t.apps.lex.tagline,
    nav: [
      {
        path: "/lex",
        icon: FileText,
        label: (t) => t.lex.workspaces,
        exact: true
      },
      {
        // Owner-scoped, so it lives beside the workspaces rather than inside one: a code of law
        // applies to every case.
        path: "/lex/authorities",
        icon: Landmark,
        label: (t) => t.lex.authorities
      }
    ]
  },
  {
    id: "campaigns",
    basePath: "/campaigns",
    icon: Mail,
    name: (t) => t.apps.campaigns.name,
    tagline: (t) => t.apps.campaigns.tagline,
    nav: [
      {
        path: "/campaigns",
        icon: LayoutDashboard,
        label: (t) => t.dashboard.title,
        exact: true
      },
      {
        path: "/campaigns/contacts",
        icon: Users,
        label: (t) => t.dashboard.contacts
      },
      {
        path: "/campaigns/groups",
        icon: Tags,
        label: (t) => t.dashboard.groups
      },
      {
        path: "/campaigns/mailings",
        icon: Mail,
        label: (t) => t.dashboard.campaigns
      }
    ]
  }
];

export const DEFAULT_APP: SuperApp = APPS[0];

export function appById(id: AppId): SuperApp {
  return APPS.find((app) => app.id === id) ?? DEFAULT_APP;
}

export function isAppId(value: unknown): value is AppId {
  return APPS.some((app) => app.id === value);
}

/** The app that owns `pathname`, or undefined for shell-level routes (/settings, /login). */
export function appForPath(pathname: string): SuperApp | undefined {
  return APPS.find(
    (app) =>
      pathname === app.basePath || pathname.startsWith(`${app.basePath}/`)
  );
}

export function isNavItemActive(item: AppNavItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.path
    : pathname === item.path || pathname.startsWith(`${item.path}/`);
}
