
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@packages/ui";

interface FullHeightDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "4xl" | "full";
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
 * FullHeightDialog - A dialog that takes up most of the viewport height.
 * Useful for complex forms, editors, or content-heavy displays.
 * Features sticky header and footer with scrollable content in between.
 */
export function FullHeightDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerActions,
  size = "full",
  className = ""
}: FullHeightDialogProps) {
  const sizeClass = sizeClasses[size];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`!${sizeClass} h-[90vh] flex flex-col p-0 gap-0 ${className}`}
      >
        {/* Sticky Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border flex-shrink-0">
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

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

        {/* Sticky Footer */}
        {footer && (
          <div className="px-6 py-4 border-t border-border flex-shrink-0 bg-card">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
