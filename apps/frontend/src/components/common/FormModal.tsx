import React, { type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@packages/ui";

interface FormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  trigger?: React.ReactElement;
  children: Exclude<ReactNode, bigint>;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "4xl";
}

export function FormModal({
  open,
  onOpenChange,
  title,
  description,
  trigger,
  children
}: FormModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger as any}</DialogTrigger>}
      <DialogContent className={`flex flex-col !max-w-[90vw] !h-[90vh]`}>
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-2 -mr-2">
          {children as any}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface FormModalFooterProps {
  onCancel: () => void;
  onSubmit?: () => void;
  cancelText?: string;
  submitText?: string;
  isSubmitting?: boolean;
  submitDisabled?: boolean;
}

export function FormModalFooter({
  onCancel,
  onSubmit,
  cancelText = "Cancel",
  submitText = "Submit",
  isSubmitting = false,
  submitDisabled = false
}: FormModalFooterProps) {
  return (
    <div className="flex justify-end gap-2 pt-4">
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={isSubmitting}
      >
        {cancelText}
      </Button>
      <Button
        type={onSubmit ? "button" : "submit"}
        onClick={onSubmit}
        disabled={isSubmitting || submitDisabled}
      >
        {isSubmitting ? "Loading..." : submitText}
      </Button>
    </div>
  );
}
