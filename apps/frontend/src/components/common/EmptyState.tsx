import { type ReactNode } from "react";
import { Button, Card, CardContent } from "@packages/ui";
import { type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  children?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  children
}: EmptyStateProps) {
  return (
    <Card className={`border-dashed border-2 ${className || ""}`}>
      <CardContent className="p-8 lg:p-12">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 lg:h-16 lg:w-16 rounded-full bg-muted flex items-center justify-center mb-6">
            <Icon className="h-6 w-6 lg:h-8 lg:w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg lg:text-xl font-semibold text-foreground mb-2">
            {title}
          </h3>
          <p className="text-sm lg:text-base text-muted-foreground mb-6 max-w-sm mx-auto">
            {description}
          </p>
          {action && (
            <Button onClick={action.onClick} size="sm">
              {action.label}
            </Button>
          )}
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
