
import { useState } from "react";
import { Button, Input, Label, Textarea } from "@packages/ui";

interface SchemaFormData {
  name: string;
  version: number;
  definition: string;
}

interface SchemaFormProps {
  initialData?: Partial<SchemaFormData>;
  onSubmit: (data: SchemaFormData) => void;
  onCancel: () => void;
  submitText?: string;
  isSubmitting?: boolean;
}

export function SchemaForm({
  initialData,
  onSubmit,
  onCancel,
  submitText = "Create",
  isSubmitting = false
}: SchemaFormProps) {
  const [formData, setFormData] = useState<SchemaFormData>({
    name: initialData?.name || "",
    version: initialData?.version || 1,
    definition:
      initialData?.definition ||
      JSON.stringify(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          title: "New Extraction Schema",
          description: "Description of your extraction schema",
          properties: {},
          required: []
        },
        null,
        2
      )
  });

  const [errors, setErrors] = useState<
    Partial<Record<keyof SchemaFormData, string>>
  >({});

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof SchemaFormData, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    }

    if (formData.version < 1) {
      newErrors.version = "Version must be at least 1";
    }

    try {
      JSON.parse(formData.definition);
    } catch (e) {
      newErrors.definition = "Invalid JSON format";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit({
        ...formData,
        definition: formData.definition
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Schema Name</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., material-extraction"
          disabled={isSubmitting}
        />
        {errors.name && (
          <p className="text-sm text-destructive mt-1">{errors.name}</p>
        )}
      </div>

      <div>
        <Label htmlFor="version">Version</Label>
        <Input
          id="version"
          type="number"
          min="1"
          value={formData.version}
          onChange={(e) =>
            setFormData({ ...formData, version: parseInt(e.target.value) || 1 })
          }
          disabled={isSubmitting || !!initialData?.version}
        />
        {errors.version && (
          <p className="text-sm text-destructive mt-1">{errors.version}</p>
        )}
        {initialData?.version && (
          <p className="text-sm text-muted-foreground mt-1">
            Version cannot be changed when editing
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="definition">JSON Schema Definition</Label>
        <Textarea
          id="definition"
          value={formData.definition}
          onChange={(e) =>
            setFormData({ ...formData, definition: e.target.value })
          }
          placeholder="Enter JSON schema definition"
          rows={15}
          className="font-mono text-sm"
          disabled={isSubmitting}
        />
        {errors.definition && (
          <p className="text-sm text-destructive mt-1">{errors.definition}</p>
        )}
        <p className="text-sm text-muted-foreground mt-1">
          Enter a valid JSON Schema (draft 2020-12 format)
        </p>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : submitText}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
