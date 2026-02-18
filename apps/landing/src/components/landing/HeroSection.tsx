import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { ChefHat, ArrowDown } from "lucide-react";

export default function HeroSection() {
  const { t } = useLanguage();

  const scrollToContact = () => {
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="hero" className="min-h-screen gradient-hero flex items-center pt-20">
      <div className="container mx-auto px-4 py-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8 animate-fade-up">
            <div className="inline-flex items-center gap-2 bg-secondary/60 backdrop-blur-sm px-4 py-2 rounded-full">
              <ChefHat className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-secondary-foreground">Thermomix Advisor</span>
            </div>

            <div className="space-y-4">
              <p className="text-lg text-muted-foreground font-medium">{t.hero.greeting}</p>
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-serif font-bold text-foreground leading-tight">{t.hero.name}</h1>
              <p className="text-xl md:text-2xl text-primary font-serif italic">{t.hero.tagline}</p>
            </div>

            <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">{t.hero.subtitle}</p>

            <Button onClick={scrollToContact} size="lg" className="gradient-terracotta text-primary-foreground hover:opacity-90 transition-opacity text-lg px-8 py-6">
              {t.hero.cta}
            </Button>
          </div>

          <div className="relative animate-scale-in" style={{ animationDelay: "0.2s" }}>
            <div className="relative aspect-square max-w-md mx-auto">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 animate-pulse" />
              <div className="absolute inset-4 rounded-full bg-gradient-to-tr from-secondary to-sage-light" />
              <div className="absolute inset-8 rounded-full overflow-hidden bg-card shadow-2xl flex items-center justify-center">
                <div className="text-center p-8">
                  <ChefHat className="w-24 h-24 mx-auto text-primary mb-4" />
                  <p className="font-serif text-2xl text-foreground font-semibold">Thermomix</p>
                  <p className="text-muted-foreground">Excellence culinaire</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce hidden lg:block">
          <ArrowDown className="w-6 h-6 text-muted-foreground" />
        </div>
      </div>
    </section>
  );
}
