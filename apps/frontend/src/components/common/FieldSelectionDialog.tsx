import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Label } from "@packages/ui";
import { Loader2 } from "lucide-react";
import { ScrollableDialog } from "./ScrollableDialog";

export interface FieldOption {
  key: string;
  label: string;
}

interface FieldSelectionDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  dataFields: FieldOption[];
  metaFields?: FieldOption[];
  defaultSelectedKeys?: string[];
  onClose: () => void;
  onConfirm: (selectedKeys: string[]) => void;
  confirmLabel?: string;
  allowEmptySelection?: boolean;
  isConfirming?: boolean;
  renderConfirmButton?: (props: {
    selectedCount: number;
    selectedKeys: string[];
    disabled: boolean;
    isConfirming: boolean;
    onConfirm: () => void;
  }) => React.ReactNode;
}

export function FieldSelectionDialog({
  isOpen,
  title,
  description,
  dataFields,
  metaFields = [],
  defaultSelectedKeys = [],
  onClose,
  onConfirm,
  confirmLabel = "Confirm",
  allowEmptySelection = false,
  isConfirming = false,
  renderConfirmButton
}: FieldSelectionDialogProps) {
  const allFieldOptions = useMemo(
    () => [...dataFields, ...metaFields],
    [dataFields, metaFields]
  );

  const allFieldKeys = useMemo(
    () => allFieldOptions.map((option) => option.key),
    [allFieldOptions]
  );

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    new Set(defaultSelectedKeys)
  );

  useEffect(() => {
    if (isOpen) {
      setSelectedKeys(
        new Set(defaultSelectedKeys.filter((key) => allFieldKeys.includes(key)))
      );
    }
  }, [isOpen, defaultSelectedKeys, allFieldKeys]);

  const toggleField = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedKeys(new Set(allFieldKeys));
  };

  const deselectAll = () => {
    setSelectedKeys(new Set());
  };

  const selectedArray = useMemo(() => Array.from(selectedKeys), [selectedKeys]);
  const selectedCount = selectedArray.length;

  const confirmDisabled =
    (selectedCount === 0 && !allowEmptySelection) || isConfirming;

  const handleConfirm = () => {
    if (confirmDisabled) return;
    onConfirm(selectedArray);
  };

  const renderSection = (
    sectionTitle: string,
    options: FieldOption[],
    idPrefix: string
  ) => {
    if (!options.length) return null;

    return (
      <div className="space-y-3">
        <h4 className="text-sm font-medium">{sectionTitle}</h4>
        <div className="grid grid-cols-2 gap-3">
          {options.map((option) => {
            const checkboxId = `${idPrefix}-${option.key}`.replace(
              /[^a-zA-Z0-9_-]/g,
              "-"
            );
            return (
              <div key={option.key} className="flex items-center space-x-2">
                <Checkbox
                  id={checkboxId}
                  checked={selectedKeys.has(option.key)}
                  onCheckedChange={() => toggleField(option.key)}
                />
                <Label htmlFor={checkboxId} className="text-sm cursor-pointer">
                  {option.label}
                </Label>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const footerConfirmButton = renderConfirmButton ? (
    renderConfirmButton({
      selectedCount,
      selectedKeys: selectedArray,
      disabled: confirmDisabled,
      isConfirming,
      onConfirm: handleConfirm
    })
  ) : (
    <Button
      onClick={handleConfirm}
      disabled={confirmDisabled}
      className="gap-2"
    >
      {isConfirming && <Loader2 className="h-4 w-4 animate-spin" />}
      {confirmLabel}
    </Button>
  );

  return (
    <ScrollableDialog
      open={isOpen}
      onOpenChange={onClose}
      title={title}
      description={description ?? ""}
      size="2xl"
      scrollAreaHeight="500px"
      headerActions={
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={selectAll}
            className="text-xs"
            disabled={isConfirming}
          >
            Select All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={deselectAll}
            className="text-xs"
            disabled={isConfirming}
          >
            Deselect All
          </Button>
        </div>
      }
      footer={
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedCount} field{selectedCount === 1 ? "" : "s"} selected
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isConfirming}>
              Cancel
            </Button>
            {footerConfirmButton}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {renderSection("Extracted Data Fields", dataFields, "field")}
        {renderSection("Metadata Fields", metaFields, "meta")}
      </div>
    </ScrollableDialog>
  );
}
