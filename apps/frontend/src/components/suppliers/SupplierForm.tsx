import { useState } from "react";
import type {
  CreateSupplierRequest,
  UpdateSupplierRequest
} from "@packages/types";
import { Input, Label, Textarea } from "@packages/ui";
import { FormModalFooter } from "@/components/common";

interface SupplierFormData {
  name: string;
  contactName?: string | undefined;
  contactEmail: string;
  contactPhone?: string | undefined;
  materialsOffered?: string | undefined;
}

interface SupplierFormProps {
  initialData?: Partial<SupplierFormData> | null;
  onSubmit: (
    data: CreateSupplierRequest | UpdateSupplierRequest
  ) => Promise<void>;
  onCancel: () => void;
  submitText?: string;
  isSubmitting?: boolean;
}

export function SupplierForm({
  initialData,
  onSubmit,
  onCancel,
  submitText = "Create Supplier",
  isSubmitting = false
}: SupplierFormProps) {
  const [formData, setFormData] = useState<SupplierFormData>({
    name: initialData?.name || "",
    contactName: initialData?.contactName || "",
    contactEmail: initialData?.contactEmail || "",
    contactPhone: initialData?.contactPhone || "",
    materialsOffered: initialData?.materialsOffered || ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Convert materialsOffered string to array
    const materialsArray = formData.materialsOffered
      ? formData.materialsOffered
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean)
      : [];

    const submitData: CreateSupplierRequest | UpdateSupplierRequest = {
      name: formData.name,
      contactEmail: formData.contactEmail,
      ...(formData.contactName && { contactName: formData.contactName }),
      ...(formData.contactPhone && { contactPhone: formData.contactPhone }),
      ...(materialsArray.length > 0 && { materialsOffered: materialsArray })
    };

    await onSubmit(submitData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Supplier Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Enter supplier name"
          required
        />
      </div>

      <div>
        <Label htmlFor="contactEmail">Contact Email *</Label>
        <Input
          id="contactEmail"
          type="email"
          value={formData.contactEmail}
          onChange={(e) =>
            setFormData({ ...formData, contactEmail: e.target.value })
          }
          placeholder="contact@supplier.com"
          required
        />
      </div>

      <div>
        <Label htmlFor="contactName">Contact Name</Label>
        <Input
          id="contactName"
          value={formData.contactName}
          onChange={(e) =>
            setFormData({ ...formData, contactName: e.target.value })
          }
          placeholder="Enter contact person name"
        />
      </div>

      <div>
        <Label htmlFor="contactPhone">Contact Phone</Label>
        <Input
          id="contactPhone"
          type="tel"
          value={formData.contactPhone}
          onChange={(e) =>
            setFormData({ ...formData, contactPhone: e.target.value })
          }
          placeholder="+1 (555) 123-4567"
        />
      </div>

      <div>
        <Label htmlFor="materialsOffered">Materials Offered</Label>
        <Textarea
          id="materialsOffered"
          value={formData.materialsOffered}
          onChange={(e) =>
            setFormData({
              ...formData,
              materialsOffered: e.target.value
            })
          }
          placeholder="Enter materials separated by commas (e.g., Steel, Concrete, Lumber)"
          rows={3}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Separate multiple materials with commas
        </p>
      </div>

      <FormModalFooter
        onCancel={onCancel}
        submitText={submitText}
        isSubmitting={isSubmitting}
      />
    </form>
  );
}
