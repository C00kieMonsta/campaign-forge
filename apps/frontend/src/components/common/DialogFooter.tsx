
import React from "react";
import { Button } from "@packages/ui";

interface DialogFooterActionsProps {
  onCancel?: () => void;
  onConfirm?: () => void;
  cancelText?: React.ReactNode;
  confirmText?: React.ReactNode;
  isLoading?: boolean;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  confirmVariant?: "default" | "destructive" | "outline" | "secondary";
  showCancel?: boolean;
  additionalActions?: React.ReactNode;
  layout?: "space-between" | "end";
  children?: React.ReactNode;
}

/**
 * DialogFooterActions - Standardized footer with action buttons for dialogs.
 * Provides consistent spacing, button styles, and loading states.
 */
export function DialogFooterActions({
  onCancel,
  onConfirm,
  cancelText = "Cancel",
  confirmText = "Confirm",
  isLoading = false,
  confirmDisabled = false,
  cancelDisabled = false,
  confirmVariant = "default",
  showCancel = true,
  additionalActions,
  layout = "end",
  children
}: DialogFooterActionsProps) {
  // If children are provided, render them directly
  if (children) {
    return <>{children}</>;
  }

  const buttonGroup = (
    <>
      {showCancel && onCancel && (
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading || cancelDisabled}
        >
          {cancelText}
        </Button>
      )}
      {onConfirm && (
        <Button
          type="button"
          variant={confirmVariant}
          onClick={onConfirm}
          disabled={isLoading || confirmDisabled}
        >
          {isLoading ? "Loading..." : confirmText}
        </Button>
      )}
    </>
  );

  if (layout === "space-between") {
    return (
      <div className="flex items-center justify-between">
        {additionalActions && <div>{additionalActions}</div>}
        <div className="flex gap-2">{buttonGroup}</div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {additionalActions}
      {buttonGroup}
    </div>
  );
}
