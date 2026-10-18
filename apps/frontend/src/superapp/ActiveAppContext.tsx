import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  appById,
  appForPath,
  APPS,
  DEFAULT_APP,
  isAppId,
  type AppId,
  type SuperApp
} from "./registry";

interface ActiveAppContextType {
  /** The app whose nav the shell should render. */
  app: SuperApp;
  apps: SuperApp[];
  switchTo: (id: AppId) => void;
}

const ActiveAppContext = createContext<ActiveAppContextType | undefined>(
  undefined
);

const STORAGE_KEY = "superapp_active_app";

/**
 * The app this browser was last in. Read synchronously so the first paint after a refresh lands in
 * the right app with no flash of the other one.
 */
function storedAppId(): AppId {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the URL or the default app decides.
  }
  return isAppId(raw) ? raw : DEFAULT_APP.id;
}

/** Storage can be full or blocked; the choice still holds for this page view. */
function rememberAppId(id: AppId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // The next load falls back to the URL or the default app.
  }
}

/**
 * Tracks which of the hosted apps is active.
 *
 * The URL wins whenever it names an app — a deep link into /lex/... puts you in Lex regardless of
 * what was stored — and that choice is written back to localStorage, so the last app you actually
 * used is where "/" and a post-login redirect land you. Shell routes that belong to no app
 * (/settings) keep the remembered app's nav in the sidebar rather than blanking it.
 */
export function ActiveAppProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [rememberedId, setRememberedId] = useState<AppId>(storedAppId);

  const appFromUrl = appForPath(pathname);
  const app = appFromUrl ?? appById(rememberedId);

  useEffect(() => {
    if (!appFromUrl || appFromUrl.id === rememberedId) return;
    setRememberedId(appFromUrl.id);
    rememberAppId(appFromUrl.id);
  }, [appFromUrl, rememberedId]);

  const switchTo = useCallback(
    (id: AppId) => {
      setRememberedId(id);
      rememberAppId(id);
      navigate(appById(id).basePath);
    },
    [navigate]
  );

  const value = useMemo(() => ({ app, apps: APPS, switchTo }), [app, switchTo]);

  return (
    <ActiveAppContext.Provider value={value}>
      {children}
    </ActiveAppContext.Provider>
  );
}

export function useActiveApp(): ActiveAppContextType {
  const ctx = useContext(ActiveAppContext);
  if (!ctx)
    throw new Error("useActiveApp must be used within an ActiveAppProvider");
  return ctx;
}
