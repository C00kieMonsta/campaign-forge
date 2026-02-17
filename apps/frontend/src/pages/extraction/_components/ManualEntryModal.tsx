import { useMemo, useState } from "react";
import type { NormalizedExtractionSchema } from "@packages/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea
} from "@packages/ui";
import { DialogFooterActions, FullHeightDialog } from "@/components/common";

interface SchemaProperty {
  type: string;
  title?: string;
  description?: string;
  importance?: string;
  extractionInstructions?: string;
}

interface ManualEntryModalProps {
  schema: NormalizedExtractionSchema | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  isSubmitting?: boolean;
}

export function ManualEntryModal({
  schema,
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false
}: ManualEntryModalProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const schemaProperties = useMemo(() => {
    if (!schema?.definition || typeof schema.definition !== "object") {
      return [];
    }

    const def = schema.definition as {
      properties?: Record<string, SchemaProperty>;
      required?: string[];
    };

    if (!def.properties) {
      return [];
    }

    return Object.entries(def.properties)
      .map(([name, prop]) => ({
        name,
        ...prop,
        required: def.required?.includes(name) || false
      }))
      .sort((a, b) => {
        const importanceOrder = { high: 0, medium: 1, low: 2 };
        const aImportance =
          importanceOrder[a.importance as keyof typeof importanceOrder] ?? 1;
        const bImportance =
          importanceOrder[b.importance as keyof typeof importanceOrder] ?? 1;
        return aImportance - bImportance;
      });
  }, [schema]);

  const handleInputChange = (field: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setFormData({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await onSubmit(formData);
      resetForm();
      onOpenChange(false);
    } catch {
      // Error handled by parent component
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
    resetForm();
  };

  const renderField = (
    prop: SchemaProperty & { name: string; required: boolean }
  ) => {
    const { name, type, title, description, required } = prop;
    const fieldLabel = title || name;
    const value = formData[name] || "";

    switch (type) {
      case "number":
        return (
          <div key={name} className="space-y-2">
            <Label htmlFor={name}>
              {fieldLabel}
              {required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={name}
              type="number"
              step="0.01"
              value={value as string}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                handleInputChange(name, e.target.value)
              }
              placeholder={description || `Enter ${fieldLabel.toLowerCase()}`}
              required={required}
              disabled={isSubmitting}
            />
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        );

      case "boolean":
        return (
          <div key={name} className="space-y-2">
            <Label htmlFor={name} className="flex items-center gap-2">
              <input
                id={name}
                type="checkbox"
                checked={!!value}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  handleInputChange(name, e.target.checked)
                }
                disabled={isSubmitting}
                className="h-4 w-4"
              />
              {fieldLabel}
              {required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        );

      default:
        if (
          name.includes("notes") ||
          name.includes("description") ||
          name.includes("specifications")
        ) {
          return (
            <div key={name} className="space-y-2">
              <Label htmlFor={name}>
                {fieldLabel}
                {required && <span className="text-red-500 ml-1">*</span>}
              </Label>
              <Textarea
                id={name}
                value={value as string}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  handleInputChange(name, e.target.value)
                }
                placeholder={description || `Enter ${fieldLabel.toLowerCase()}`}
                rows={3}
                required={required}
                disabled={isSubmitting}
              />
              {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
              )}
            </div>
          );
        }

        return (
          <div key={name} className="space-y-2">
            <Label htmlFor={name}>
              {fieldLabel}
              {required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={name}
              type="text"
              value={value as string}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                handleInputChange(name, e.target.value)
              }
              placeholder={description || `Enter ${fieldLabel.toLowerCase()}`}
              required={required}
              disabled={isSubmitting}
            />
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        );
    }
  };

  const firstRequiredField = schemaProperties.find((p) => p.required);
  const isSubmitDisabled =
    firstRequiredField && !formData[firstRequiredField.name];

  return (
    <FullHeightDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Add Manual Entry${schema ? ` - ${schema.name}` : ""}`}
      footer={
        <DialogFooterActions
          onCancel={handleCancel}
          onConfirm={() => {
            document
              .getElementById("manual-entry-form")
              ?.dispatchEvent(
                new Event("submit", { cancelable: true, bubbles: true })
              );
          }}
          confirmText="Add Entry"
          isLoading={isSubmitting}
          confirmDisabled={!!isSubmitDisabled}
        />
      }
    >
      <form
        onSubmit={handleSubmit}
        className="space-y-6"
        id="manual-entry-form"
      >
        {schemaProperties.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground">
              No schema available. Unable to create manual entry.
            </p>
          </div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  {schema?.name || "Extraction Data"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {schemaProperties.map(renderField)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Document Reference
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pageNumber">Page Number</Label>
                    <Input
                      id="pageNumber"
                      type="number"
                      min="1"
                      value={(formData.pageNumber as string) || "1"}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleInputChange("pageNumber", e.target.value)
                      }
                      placeholder="Enter page number"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="locationInDoc">Location in Document</Label>
                    <Input
                      id="locationInDoc"
                      value={(formData.locationInDoc as string) || ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleInputChange("locationInDoc", e.target.value)
                      }
                      placeholder="e.g., Table 3, Section A, etc."
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="originalSnippet">Original Text/Context</Label>
                  <Textarea
                    id="originalSnippet"
                    value={(formData.originalSnippet as string) || ""}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      handleInputChange("originalSnippet", e.target.value)
                    }
                    placeholder="Enter the original text or context where this information was found"
                    rows={4}
                    disabled={isSubmitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    This helps provide context for where the manual entry came
                    from
                  </p>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </form>
    </FullHeightDialog>
  );
}
