
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea
} from "@packages/ui";

interface ScrollableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "4xl" | "full";
  scrollAreaHeight?: string;
  className?: string;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "4xl": "max-w-4xl",
  full: "max-w-[90vw]"
};

/**
 * ScrollableDialog - A dialog with a scrollable content area and optional sticky footer.
 * Perfect for forms, data displays, and content that may overflow.
 */
export function ScrollableDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerActions,
  size = "lg",
  scrollAreaHeight = "400px",
  className = ""
}: ScrollableDialogProps) {
  const sizeClass = sizeClasses[size];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`${sizeClass} max-h-[80vh] overflow-hidden flex flex-col ${className}`}
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </div>
            {headerActions && (
              <div className="flex-shrink-0">{headerActions}</div>
            )}
          </div>
        </DialogHeader>

        <ScrollArea
          className={`flex-1 pr-4`}
          style={{ maxHeight: scrollAreaHeight }}
        >
          {children}
        </ScrollArea>

        {footer && (
          <div className="pt-4 border-t border-border flex-shrink-0">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
