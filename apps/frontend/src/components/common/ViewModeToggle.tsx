import { type ReactNode } from "react";
import { Button, cn } from "@packages/ui";

interface ViewModeOption {
  key: string;
  label: string;
  icon: ReactNode;
  ariaLabel: string;
}

interface ViewModeToggleProps<T extends string = string> {
  currentMode: T;
  options: ViewModeOption[];
  onModeChange: (mode: T) => void;
  className?: string;
}

export function ViewModeToggle<T extends string = string>({
  currentMode,
  options,
  onModeChange,
  className
}: ViewModeToggleProps<T>) {
  return (
    <div className={cn("inline-flex rounded-lg bg-muted p-1", className)}>
      {options.map((option) => (
        <Button
          key={option.key}
          variant="ghost"
          size="sm"
          onClick={() => onModeChange(option.key as T)}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
            currentMode === option.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
          )}
          aria-label={option.ariaLabel}
        >
          {option.icon}
          <span className="hidden sm:inline">{option.label}</span>
        </Button>
      ))}
    </div>
  );
}
