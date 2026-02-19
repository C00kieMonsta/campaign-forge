import { useState } from "react";
import { Mail, MapPin, Phone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export default function ContactSection() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const form = e.currentTarget;
    const data = new FormData(form);

    try {
      const res = await fetch(`${API_BASE}/public/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          firstName: data.get("firstName"),
          lastName: data.get("lastName")
        })
      });

      const json = await res.json();

      if (res.ok) {
        toast({
          title:
            json.message === "Already subscribed"
              ? t.contact.alreadySubscribed
              : t.contact.success
        });
        form.reset();
      } else {
        toast({
          variant: "destructive",
          title: t.contact.error,
          description: json.error
        });
      }
    } catch {
      toast({ variant: "destructive", title: t.contact.error });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="contact" className="py-24 bg-card">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-4">
            {t.contact.title}
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {t.contact.subtitle}
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 max-w-5xl mx-auto">
          <div className="space-y-8">
            <div className="card-elevated p-8">
              <h3 className="text-2xl font-serif font-semibold text-foreground mb-6">
                Monique Pirson
              </h3>
              <div className="space-y-4">
                {[
                  {
                    icon: Phone,
                    label: "Téléphone",
                    value: "+32 475 42 94 20"
                  },
                  { icon: Mail, label: "Email", value: "monpirson@gmail.com" },
                  { icon: MapPin, label: "Région", value: "Belgique" }
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{label}</p>
                      <p className="font-medium text-foreground">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="card-elevated p-8">
            <div className="space-y-6">
              <Input
                name="firstName"
                type="text"
                placeholder={t.contact.firstName}
                required
                className="bg-background border-border focus:border-primary"
              />
              <Input
                name="lastName"
                type="text"
                placeholder={t.contact.lastName}
                required
                className="bg-background border-border focus:border-primary"
              />
              <Input
                name="email"
                type="email"
                placeholder={t.contact.email}
                required
                className="bg-background border-border focus:border-primary"
              />
              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full gradient-terracotta text-primary-foreground hover:opacity-90 transition-opacity"
              >
                {isSubmitting ? (
                  <span className="animate-spin">⏳</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    {t.contact.subscribe}
                  </span>
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
