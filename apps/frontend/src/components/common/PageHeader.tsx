import { type ReactNode } from "react";
import { Button } from "@packages/ui";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

interface PageHeaderProps {
  title: string;
  description?: string;
  backLink?: {
    href: string;
    label: string;
  };
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  backLink,
  actions,
  children,
  className
}: PageHeaderProps) {
  return (
    <header className={` bg-card ${className || ""}`}>
      <div className="container mx-auto px-6 py-4">
        {backLink && (
          <div className="flex items-center gap-4 mb-4">
            <Link to={backLink.href}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                {backLink.label}
              </Button>
            </Link>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </div>

        {children}
      </div>
    </header>
  );
}
