import { useEffect, useMemo, useState } from "react";
import { Users, UserMinus, Send, FileEdit } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { api } from "@/lib/api";
import type { Campaign } from "@packages/types";

interface ContactStats {
  total: number;
  subscribed: number;
  unsubscribed: number;
}

export default function Dashboard() {
  const { t } = useLanguage();
  const [contactStats, setContactStats] = useState<ContactStats | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    api.contacts.stats().then(setContactStats).catch(() => {});
    api.campaigns.list().then((res) => setCampaigns(res.items)).catch(() => {});
  }, []);

  const lastSentCampaign = useMemo(
    () => campaigns.filter((c) => c.status === "sent").sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))[0] ?? null,
    [campaigns]
  );

  const draftCount = useMemo(() => campaigns.filter((c) => c.status === "draft").length, [campaigns]);
  const sentCount = useMemo(() => campaigns.filter((c) => c.status === "sent").length, [campaigns]);

  const topStats = [
    { label: t.dashboard.subscribedContacts, value: contactStats?.subscribed ?? "—", icon: Users, accent: true },
    { label: t.dashboard.sentCampaigns, value: sentCount, icon: Send, accent: false },
    { label: t.dashboard.draftCampaigns, value: draftCount, icon: FileEdit, accent: false },
  ];

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="animate-fade-up">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground">{t.dashboard.title}</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {topStats.map((stat) => (
          <div key={stat.label} className="card-elevated p-6">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${stat.accent ? "gradient-terracotta" : "bg-secondary"}`}>
                <stat.icon className={`h-7 w-7 ${stat.accent ? "text-white" : "text-secondary-foreground"}`} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-3xl font-serif font-bold text-foreground">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {contactStats && contactStats.unsubscribed > 0 && (
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <UserMinus className="h-4 w-4" />
          <span>{contactStats.unsubscribed} {t.dashboard.unsubscribedContacts.toLowerCase()}</span>
        </div>
      )}

      <div className="card-elevated p-6">
        <p className="text-sm font-medium text-muted-foreground mb-3">{t.dashboard.lastCampaign}</p>
        {lastSentCampaign ? (
          <div>
            <p className="text-lg font-serif font-semibold text-foreground">{lastSentCampaign.name}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t.dashboard.sentOn} {formatDate(lastSentCampaign.sentAt!)}
              {lastSentCampaign.sentCount != null && (
                <> · {lastSentCampaign.sentCount} {t.dashboard.recipients}</>
              )}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">{t.dashboard.noCampaignSent}</p>
        )}
      </div>
    </div>
  );
}
