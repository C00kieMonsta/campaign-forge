import { useState } from "react";
import { UNIT_OPTIONS } from "@packages/types";
import {
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from "@packages/ui";
import { DialogFooterActions, ScrollableDialog } from "@/components/common";
import type { FlexibleExtractionResult } from "@/components/extraction";

interface MergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: FlexibleExtractionResult[];
  onConfirm: (
    primaryId: string,
    secondaryIds: string[],
    mergedData: Record<string, unknown>
  ) => void;
}

export function MergeDialog({
  open,
  onOpenChange,
  items,
  onConfirm
}: MergeDialogProps) {
  const [primaryItemId, setPrimaryItemId] = useState<string>(
    items[0]?.id || ""
  );
  const [mergedData, setMergedData] = useState<Record<string, unknown>>({});

  const primaryItem = items.find((item) => item.id === primaryItemId);
  const secondaryItems = items.filter((item) => item.id !== primaryItemId);

  const handleMerge = (): void => {
    if (!primaryItem) {
      return;
    }

    const secondaryIds = secondaryItems.map((item) => item.id);

    const totalQuantity = items.reduce((sum, item) => {
      const rawData = (item.rawExtraction as Record<string, unknown>) || {};
      const verifiedData = (item.verifiedData as Record<string, unknown>) || {};
      const effectiveData = { ...rawData, ...verifiedData };

      const qty = Number(effectiveData.quantity) || 0;
      return sum + qty;
    }, 0);

    const primaryRawData =
      (primaryItem.rawExtraction as Record<string, unknown>) || {};
    const primaryVerifiedData =
      (primaryItem.verifiedData as Record<string, unknown>) || {};
    const primaryEffectiveData = { ...primaryRawData, ...primaryVerifiedData };

    const finalMergedData = {
      ...primaryEffectiveData,
      ...mergedData,
      quantity: totalQuantity
    };

    onConfirm(primaryItemId, secondaryIds, finalMergedData);
  };

  if (items.length < 2) return null;

  return (
    <ScrollableDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Merge ${items.length} Items`}
      description="Select which item should be the primary one and review the merged data. The quantities will be automatically combined."
      size="4xl"
      scrollAreaHeight="500px"
      footer={
        <DialogFooterActions
          onCancel={() => onOpenChange(false)}
          onConfirm={handleMerge}
          confirmText="Merge Items"
        />
      }
    >
      <div className="space-y-6">
        <div>
          <Label className="text-base font-medium">Select Primary Item</Label>
          <RadioGroup
            value={primaryItemId}
            onValueChange={setPrimaryItemId}
            className="mt-2"
          >
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-start space-x-2 p-3 border rounded-lg"
              >
                <RadioGroupItem value={item.id} id={item.id} className="mt-1" />
                <div className="flex-1">
                  {(() => {
                    const rawData =
                      (item.rawExtraction as Record<string, unknown>) || {};
                    const verifiedData =
                      (item.verifiedData as Record<string, unknown>) || {};
                    const effectiveData = { ...rawData, ...verifiedData };

                    return (
                      <>
                        <Label
                          htmlFor={item.id}
                          className="font-medium cursor-pointer"
                        >
                          {String(effectiveData.itemCode || "No code")}
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          {String(effectiveData.itemName || "No name")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Quantity: {String(effectiveData.quantity || "0")}{" "}
                          {String(effectiveData.unit || "")}
                        </p>
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
          </RadioGroup>
        </div>

        {primaryItem && (
          <div className="space-y-4">
            <Label className="text-base font-medium">Merged Item Preview</Label>

            <div className="grid grid-cols-2 gap-4">
              <div>
                {(() => {
                  const rawData =
                    (primaryItem.rawExtraction as Record<string, unknown>) ||
                    {};
                  const verifiedData =
                    (primaryItem.verifiedData as Record<string, unknown>) || {};
                  const effectiveData = { ...rawData, ...verifiedData };

                  return (
                    <div>
                      <Label htmlFor="itemCode">Material Code</Label>
                      <Input
                        id="itemCode"
                        value={String(
                          mergedData.itemCode || effectiveData.itemCode || ""
                        )}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setMergedData({
                            ...mergedData,
                            itemCode: e.target.value
                          })
                        }
                      />
                    </div>
                  );
                })()}
              </div>

              <div>
                <Label htmlFor="quantity">Total Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  value={items.reduce((sum, item) => {
                    const rawData =
                      (item.rawExtraction as Record<string, unknown>) || {};
                    const verifiedData =
                      (item.verifiedData as Record<string, unknown>) || {};
                    const effectiveData = { ...rawData, ...verifiedData };
                    const qty = Number(effectiveData.quantity) || 0;
                    return sum + qty;
                  }, 0)}
                  readOnly
                  className="bg-muted"
                />
              </div>
            </div>

            <div>
              {(() => {
                const rawData =
                  (primaryItem.rawExtraction as Record<string, unknown>) || {};
                const verifiedData =
                  (primaryItem.verifiedData as Record<string, unknown>) || {};
                const effectiveData = { ...rawData, ...verifiedData };

                return (
                  <>
                    <div>
                      <Label htmlFor="itemName">Product Type</Label>
                      <Input
                        id="itemName"
                        value={String(
                          mergedData.itemName || effectiveData.itemName || ""
                        )}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setMergedData({
                            ...mergedData,
                            itemName: e.target.value
                          })
                        }
                      />
                    </div>

                    <div>
                      <Label htmlFor="unit">Unit of Measure</Label>
                      <Select
                        value={String(
                          mergedData.unit || effectiveData.unit || ""
                        )}
                        onValueChange={(value: string) =>
                          setMergedData({
                            ...mergedData,
                            unit: value
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select unit..." />
                        </SelectTrigger>
                        <SelectContent>
                          {UNIT_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="technicalSpecifications">Finish</Label>
                      <Textarea
                        id="technicalSpecifications"
                        value={String(
                          mergedData.technicalSpecifications ||
                            effectiveData.technicalSpecifications ||
                            ""
                        )}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                          setMergedData({
                            ...mergedData,
                            technicalSpecifications: e.target.value
                          })
                        }
                        rows={3}
                      />
                    </div>

                    <div>
                      <Label htmlFor="executionNotes">Technical Data</Label>
                      <Textarea
                        id="executionNotes"
                        value={String(
                          mergedData.executionNotes ||
                            effectiveData.executionNotes ||
                            ""
                        )}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                          setMergedData({
                            ...mergedData,
                            executionNotes: e.target.value
                          })
                        }
                        rows={3}
                      />
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </ScrollableDialog>
  );
}
