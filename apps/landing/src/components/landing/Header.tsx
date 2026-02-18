import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import LanguageSwitcher from "./LanguageSwitcher";

export default function Header() {
  const { t } = useLanguage();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setIsMenuOpen(false);
  };

  const navItems = [
    { id: "hero", label: t.nav.home },
    { id: "about", label: t.nav.about },
    { id: "contact", label: t.nav.contact },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="font-serif text-2xl font-semibold text-foreground">
            Monique <span className="text-primary">Pirson</span>
          </span>

          <nav className="hidden md:flex items-center gap-8">
            {navItems.map((item) => (
              <button key={item.id} onClick={() => scrollToSection(item.id)} className="text-muted-foreground hover:text-foreground transition-colors font-medium">
                {item.label}
              </button>
            ))}
            <LanguageSwitcher />
          </nav>

          <div className="flex items-center gap-4 md:hidden">
            <LanguageSwitcher />
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="text-foreground p-2">
              {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {isMenuOpen && (
          <nav className="md:hidden mt-4 pb-4 flex flex-col gap-4 animate-fade-in">
            {navItems.map((item) => (
              <button key={item.id} onClick={() => scrollToSection(item.id)} className="text-muted-foreground hover:text-foreground transition-colors font-medium text-left">
                {item.label}
              </button>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
