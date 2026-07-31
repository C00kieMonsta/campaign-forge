import { useState } from "react";
import { Button } from "@packages/ui";
import { Check, Languages, Loader2, RefreshCw } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import type { Language } from "@/i18n/translations";
import { api } from "@/lib/api";

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "fr", label: "Français" },
  { value: "nl", label: "Nederlands" }
];

/**
 * Settings. One pinned language drives the interface AND the assistant: the backend reads it to
 * pin chat replies, rolling conversation summaries, generated drafts and document summaries, so
 * the whole product speaks one language instead of drifting.
 */
export default function Settings() {
  const { language, setLanguage, t } = useLanguage();
  const { toast } = useToast();
  const [resummarizing, setResummarizing] = useState(false);

  // Changing the language only affects documents summarized from here on; existing summaries
  // keep whatever language they were written in until they are refreshed.
  const handleResummarize = async () => {
    setResummarizing(true);
    try {
      const { queued } = await api.lex.documents.resummarizeAll();
      toast({
        title:
          queued === 0
            ? t.settings.resummarizeNone
            : `${t.settings.resummarizeQueued} (${queued})`
      });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setResummarizing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold">{t.settings.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t.settings.subtitle}
        </p>
      </div>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Languages className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="font-medium">{t.settings.language}</h2>
            <p className="text-sm text-muted-foreground">
              {t.settings.languageHint}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {LANGUAGES.map((lang) => {
            const active = language === lang.value;
            return (
              <button
                key={lang.value}
                onClick={() => setLanguage(lang.value)}
                aria-pressed={active}
                className={`w-full flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                  active
                    ? "border-sidebar-primary bg-muted"
                    : "hover:bg-muted/50"
                }`}
              >
                <span className="font-medium">{lang.label}</span>
                {active ? (
                  <Check className="h-4 w-4 text-sidebar-primary shrink-0" />
                ) : null}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {t.settings.quotesStayVerbatim}
        </p>
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-start gap-3">
          <RefreshCw className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="font-medium">{t.settings.existingDocuments}</h2>
            <p className="text-sm text-muted-foreground">
              {t.settings.existingDocumentsHint}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleResummarize()}
          disabled={resummarizing}
        >
          {resummarizing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {t.settings.resummarize}
        </Button>
      </section>
    </div>
  );
}
