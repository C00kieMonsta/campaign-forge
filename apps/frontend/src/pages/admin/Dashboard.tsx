import { useMemo } from "react";
import { Users, Mail, UserPlus } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useLocalStorage } from "@/hooks/use-local-storage";

interface Contact {
  email: string;
  createdAt: string;
}

export default function Dashboard() {
  const { t } = useLanguage();
  const [contacts] = useLocalStorage<Contact[]>("cf_contacts", []);

  const stats = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const withEmail = contacts.filter((c) => c.email).length;
    const recent = contacts.filter((c) => new Date(c.createdAt).getTime() > sevenDaysAgo).length;

    return [
      { labelKey: "totalContacts" as const, value: contacts.length, icon: Users },
      { labelKey: "withEmail" as const, value: withEmail, icon: Mail },
      { labelKey: "recentlyAdded" as const, value: recent, icon: UserPlus },
    ];
  }, [contacts]);

  const statLabels: Record<string, string> = {
    totalContacts: t.dashboard.totalContacts,
    withEmail: t.dashboard.withEmail,
    recentlyAdded: t.dashboard.recentlyAdded,
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground">
          {t.dashboard.title}
        </h1>
        <p className="text-muted-foreground mt-1">
          Bienvenue dans votre espace administration
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat) => (
          <div key={stat.labelKey} className="card-elevated p-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl gradient-terracotta flex items-center justify-center">
                <stat.icon className="h-7 w-7 text-white" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {statLabels[stat.labelKey]}
                </p>
                <p className="text-3xl font-serif font-bold text-foreground">
                  {stat.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
