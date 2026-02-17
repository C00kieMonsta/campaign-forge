import { useState } from "react";
import { Input, Label, Textarea } from "@packages/ui";
import { FormModalFooter } from "@/components/common";

interface ClientFormData {
  name: string;
  description?: string | undefined;
}

interface ClientFormProps {
  initialData?: ClientFormData;
  onSubmit: (data: ClientFormData) => Promise<void>;
  onCancel: () => void;
  submitText?: string;
  isSubmitting?: boolean;
}

export function ClientForm({
  initialData = { name: "", description: "" },
  onSubmit,
  onCancel,
  submitText = "Create Client",
  isSubmitting = false
}: ClientFormProps) {
  const [formData, setFormData] = useState<ClientFormData>(initialData);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Client Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Enter client name"
          required
        />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description || ""}
          onChange={(e) =>
            setFormData({
              ...formData,
              description: e.target.value
            })
          }
          placeholder="Enter client description"
          rows={3}
        />
      </div>
      <FormModalFooter
        onCancel={onCancel}
        submitText={submitText}
        isSubmitting={isSubmitting}
      />
    </form>
  );
}
