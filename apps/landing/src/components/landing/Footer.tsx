import { useLanguage } from "@/contexts/LanguageContext";

export default function Footer() {
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-foreground text-background py-12">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-center md:text-left">
            <p className="font-serif text-xl font-semibold mb-1">Monique Pirson</p>
            <p className="text-background/60 text-sm">Thermomix Advisor</p>
          </div>
          <p className="text-background/60 text-sm">
            © {currentYear} Monique Pirson. {t.footer.rights}.
          </p>
        </div>
      </div>
    </footer>
  );
}
