import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import {
  getTranslation,
  translations,
  type Language
} from "@/i18n/translations";
import { api } from "@/lib/api";

type TranslationType = typeof translations.fr;

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationType;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
);

const STORAGE_KEY = "lex_language";
const TOKEN_KEY = "admin_token";

function storedLanguage(): Language {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "fr" || raw === "nl" ? raw : "fr";
}

/**
 * Owns the one pinned language. It is read locally first (from localStorage, so there is no
 * flash of the wrong language on load) and then reconciled with the server, which is the source
 * of truth across devices and — crucially — the value the backend uses to pin the assistant's
 * replies, summaries and drafts.
 *
 * This provider sits ABOVE AuthProvider, so it reads the token from sessionStorage rather than
 * useAuth(), and it only talks to the server when a token exists: an unauthenticated call would
 * trip api.ts's 401 handler and bounce the browser to /login. Every server call is best-effort,
 * so a deployment without Lex configured still renders the admin UI from localStorage alone.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(storedLanguage);

  useEffect(() => {
    if (!sessionStorage.getItem(TOKEN_KEY)) return;
    let cancelled = false;
    api.lex.settings
      .get()
      .then(({ settings }) => {
        if (cancelled) return;
        setLanguageState(settings.language);
        localStorage.setItem(STORAGE_KEY, settings.language);
      })
      .catch(() => {
        /* Lex not configured, or offline — the local value stands. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    // Apply locally first so the UI switches instantly, then persist.
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    if (!sessionStorage.getItem(TOKEN_KEY)) return;
    void api.lex.settings.update(lang).catch(() => {
      /* best-effort: the UI language still changed for this session */
    });
  }, []);

  const t = getTranslation(language);
  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context)
    throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
