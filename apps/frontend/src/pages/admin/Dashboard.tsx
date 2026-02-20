import { useEffect, useMemo, useState } from "react";
import { Users, Mail, UserPlus, Send, FileEdit, CheckCircle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { api } from "@/lib/api";

interface Contact {
  email: string;
  createdAt: string;
  status: string;
}

interface Campaign {
  status: string;
}

export default function Dashboard() {
  const { t } = useLanguage();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    api.contacts.list({ limit: 200 }).then((res) => setContacts(res.items)).catch(() => {});
    api.campaigns.list().then((res) => setCampaigns(res.items)).catch(() => {});
  }, []);

  const contactStats = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return [
      { label: t.dashboard.totalContacts, value: contacts.length, icon: Users },
      { label: t.dashboard.withEmail, value: contacts.filter((c) => c.email).length, icon: Mail },
      { label: t.dashboard.recentlyAdded, value: contacts.filter((c) => new Date(c.createdAt).getTime() > sevenDaysAgo).length, icon: UserPlus },
    ];
  }, [contacts, t]);

  const campaignStats = useMemo(() => [
    { label: t.dashboard.totalCampaigns, value: campaigns.length, icon: Send },
    { label: t.dashboard.draftCampaigns, value: campaigns.filter((c) => c.status === "draft").length, icon: FileEdit },
    { label: t.dashboard.sentCampaigns, value: campaigns.filter((c) => c.status === "sent").length, icon: CheckCircle },
  ], [campaigns, t]);

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {contactStats.map((stat) => (
          <div key={stat.label} className="card-elevated p-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl gradient-terracotta flex items-center justify-center">
                <stat.icon className="h-7 w-7 text-white" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-3xl font-serif font-bold text-foreground">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {campaignStats.map((stat) => (
          <div key={stat.label} className="card-elevated p-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center">
                <stat.icon className="h-7 w-7 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-3xl font-serif font-bold text-foreground">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
