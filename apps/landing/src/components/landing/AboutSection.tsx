import { useLanguage } from "@/contexts/LanguageContext";
import { Users, Calendar, BookOpen } from "lucide-react";

export default function AboutSection() {
  const { t } = useLanguage();

  const stats = [
    { icon: Calendar, value: "10+", label: t.about.experience },
    { icon: Users, value: "200+", label: t.about.clients },
    { icon: BookOpen, value: "500+", label: t.about.recipes },
  ];

  return (
    <section id="about" className="py-24 bg-card">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6">{t.about.title}</h2>
          <p className="text-lg text-muted-foreground leading-relaxed">{t.about.description}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-3xl mx-auto">
          {stats.map((stat, index) => (
            <div key={index} className="card-elevated p-8 text-center hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                <stat.icon className="w-8 h-8 text-primary" />
              </div>
              <p className="text-4xl font-serif font-bold text-foreground mb-2">{stat.value}</p>
              <p className="text-muted-foreground font-medium">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
