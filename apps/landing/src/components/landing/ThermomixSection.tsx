import { useLanguage } from "@/contexts/LanguageContext";
import { Layers, Award, Sparkles, Heart } from "lucide-react";

export default function ThermomixSection() {
  const { t } = useLanguage();

  const features = [
    { icon: Layers, ...t.thermomix.features.versatile },
    { icon: Award, ...t.thermomix.features.quality },
    { icon: Sparkles, ...t.thermomix.features.easy },
    { icon: Heart, ...t.thermomix.features.healthy },
  ];

  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-4">{t.thermomix.title}</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">{t.thermomix.subtitle}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <div key={index} className="group p-6 rounded-2xl bg-gradient-to-br from-card to-secondary/30 border border-border/50 hover:border-primary/30 transition-all hover:shadow-lg">
              <div className="w-14 h-14 mb-4 rounded-xl gradient-terracotta flex items-center justify-center group-hover:scale-110 transition-transform">
                <feature.icon className="w-7 h-7 text-primary-foreground" />
              </div>
              <h3 className="text-xl font-serif font-semibold text-foreground mb-2">{feature.title}</h3>
              <p className="text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
