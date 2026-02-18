import { useLanguage } from "@/contexts/LanguageContext";
import type { Language } from "@/i18n/translations";

const languages: { code: Language; label: string }[] = [
  { code: "fr", label: "FR" },
  { code: "nl", label: "NL" },
];

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-1 bg-muted rounded-full p-1">
      {languages.map((lang) => (
        <button
          key={lang.code}
          onClick={() => setLanguage(lang.code)}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
            language === lang.code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}
