import { useState } from "react";
import type { AgentDefinition, SchemaProperty } from "@packages/types";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea
} from "@packages/ui";
import {
  Bot,
  ChevronRight,
  FileText,
  Info,
  Plus,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { ConfirmationDialog } from "@/components/common";
import { PostProcessingAgentsSection } from "./PostProcessingAgentsSection";

// NestedFieldRow Component
interface NestedFieldRowProps {
  field: SchemaProperty;
  onUpdate: (updates: Partial<SchemaProperty>) => void;
  onDelete: () => void;
  disabled: boolean;
  index: number;
}

function NestedFieldRow({
  field,
  onUpdate,
  onDelete,
  disabled,
  index
}: NestedFieldRowProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <>
      <div className="rounded-lg border bg-background p-3 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
            <div className="space-y-1">
              <Label
                htmlFor={`nested-name-${field.name}-${index}`}
                className="text-xs"
              >
                Field Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id={`nested-name-${field.name}-${index}`}
                placeholder="e.g., itemCode"
                value={field.name}
                onChange={(e) => {
                  const name = e.target.value;
                  // Auto-generate title from name (convert camelCase to Title Case)
                  const title = name
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (str) => str.toUpperCase())
                    .trim();
                  onUpdate({ name, title: title || name });
                }}
                disabled={disabled}
                required
                className="h-9"
              />
            </div>

            <div className="space-y-1">
              <Label
                htmlFor={`nested-type-${field.name}-${index}`}
                className="text-xs"
              >
                Type
              </Label>
              <Select
                value={field.type}
                onValueChange={(value) => {
                  // Prevent nested lists of objects
                  if (value === "list") {
                    onUpdate({ type: value as any, itemType: "string" });
                  } else {
                    const updates: Partial<SchemaProperty> = {
                      type: value as any
                    };
                    // Only include itemType and fields if they need to be removed
                    // With exactOptionalPropertyTypes, we can't set to undefined
                    // Instead, we omit them from the update
                    onUpdate(updates);
                  }
                }}
                disabled={disabled ?? false}
              >
                <SelectTrigger
                  id={`nested-type-${field.name}-${index}`}
                  className="h-9 w-[120px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">Text</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="boolean">Yes/No</SelectItem>
                  <SelectItem value="list">List</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {field.type === "list" && (
              <div className="space-y-1">
                <Label
                  htmlFor={`nested-itemtype-${field.name}-${index}`}
                  className="text-xs"
                >
                  Item Type
                </Label>
                <Select
                  value={field.itemType || "string"}
                  onValueChange={(value) =>
                    onUpdate({ itemType: value as any })
                  }
                  disabled={disabled ?? false}
                >
                  <SelectTrigger
                    id={`nested-itemtype-${field.name}-${index}`}
                    className="h-9 w-[120px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">Text</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="boolean">Yes/No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-end">
              <label className="flex items-center gap-2 h-9">
                <Checkbox
                  id={`nested-required-${field.name}-${index}`}
                  checked={field.required}
                  onCheckedChange={(checked) =>
                    onUpdate({ required: checked === true })
                  }
                  className="h-4 w-4 rounded border-input"
                  disabled={disabled}
                />
                <span className="text-xs font-medium whitespace-nowrap">
                  Required
                </span>
              </label>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={disabled}
            className="h-9 w-9 p-0 shrink-0"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ConfirmationDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Nested Field"
        description={`Are you sure you want to delete "${field.name || "this field"}"? This action cannot be undone.`}
        confirmText="Delete"
        onConfirm={() => {
          onDelete();
          setShowDeleteConfirm(false);
        }}
        isLoading={false}
        isDestructive={true}
      />
    </>
  );
}

// NestedFieldEditor Component
interface NestedFieldEditorProps {
  fields: SchemaProperty[];
  onFieldsChange: (fields: SchemaProperty[]) => void;
  disabled?: boolean;
}

function NestedFieldEditor({
  fields,
  onFieldsChange,
  disabled
}: NestedFieldEditorProps) {
  const addField = () => {
    const newField: SchemaProperty = {
      name: "",
      title: "", // Will be auto-generated from name
      type: "string",
      description: "",
      priority: "medium",
      required: false,
      importance: "medium",
      extractionInstructions: "",
      examples: []
    };
    onFieldsChange([...fields, newField]);
  };

  return (
    <div className="space-y-4 border-l-2 border-primary/30 pl-4 ml-2">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">Object Structure</h4>
          <p className="text-xs text-muted-foreground">
            Define the fields for each object in the list
          </p>
        </div>
      </div>

      {fields.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            No fields defined yet. Add fields to structure your objects.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <NestedFieldRow
              key={index}
              field={field}
              index={index}
              onUpdate={(updates) => {
                const newFields = [...fields];
                newFields[index] = { ...field, ...updates };
                onFieldsChange(newFields);
              }}
              onDelete={() => {
                onFieldsChange(fields.filter((_, i) => i !== index));
              }}
              disabled={disabled ?? false}
            />
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addField}
        disabled={disabled}
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Nested Field
      </Button>
    </div>
  );
}

export interface SchemaFormData {
  name: string;
  version: number;
  properties: SchemaProperty[];
  prompt: string;
  examples: Record<string, any>[];
  agents?: AgentDefinition[];
  changeDescription?: string;
}

interface SchemaFormAdvancedProps {
  initialData?: Partial<SchemaFormData>;
  onSubmit: (data: SchemaFormData) => void;
  onCancel: () => void;
  submitText?: string;
  isSubmitting?: boolean;
}

interface PropertyExample {
  id: string;
  input: string;
  output: string;
}

export function SchemaFormAdvanced({
  initialData,
  onSubmit,
  onCancel,
  submitText = "Create",
  isSubmitting = false
}: SchemaFormAdvancedProps) {
  const [currentStep, setCurrentStep] = useState<"schema" | "agents">("schema");
  const [activeTab, setActiveTab] = useState<string>("general");
  const [formData, setFormData] = useState<SchemaFormData>({
    name: initialData?.name || "",
    version: initialData?.version || 1,
    properties: initialData?.properties || [],
    prompt: initialData?.prompt || "",
    examples: initialData?.examples || [],
    agents: initialData?.agents || [],
    changeDescription: initialData?.changeDescription || ""
  });

  const [errors, setErrors] = useState<
    Partial<Record<keyof SchemaFormData, string>>
  >({});

  const [propertyToDelete, setPropertyToDelete] = useState<number | null>(null);

  const addProperty = () => {
    const newProperty: SchemaProperty = {
      name: "",
      title: "",
      type: "string",
      description: "",
      priority: "medium",
      extractionInstructions: "",
      importance: "medium",
      required: false,
      examples: []
    };
    setFormData({
      ...formData,
      properties: [...formData.properties, newProperty]
    });
    // Switch to the new property tab (use index as identifier)
    setActiveTab(`property-${formData.properties.length}`);
  };

  const confirmDeleteProperty = (index: number) => {
    setPropertyToDelete(index);
  };

  const deleteProperty = () => {
    if (propertyToDelete === null) return;

    setFormData({
      ...formData,
      properties: formData.properties.filter((_, i) => i !== propertyToDelete)
    });
    setActiveTab("general");
    setPropertyToDelete(null);
  };

  const cancelDeleteProperty = () => {
    setPropertyToDelete(null);
  };

  const updateProperty = (index: number, updates: Partial<SchemaProperty>) => {
    setFormData({
      ...formData,
      properties: formData.properties.map((prop, i) =>
        i === index ? { ...prop, ...updates } : prop
      )
    });
  };

  const addExample = (propertyIndex: number) => {
    const property = formData.properties[propertyIndex];
    const newExample: PropertyExample = {
      id: crypto.randomUUID(),
      input: "",
      output: ""
    };
    updateProperty(propertyIndex, {
      examples: [...(property.examples || []), newExample]
    });
  };

  const updateExample = (
    propertyIndex: number,
    exampleId: string,
    updates: Partial<PropertyExample>
  ) => {
    const property = formData.properties[propertyIndex];
    updateProperty(propertyIndex, {
      examples: (property.examples || []).map((ex: any) =>
        ex.id === exampleId ? { ...ex, ...updates } : ex
      )
    });
  };

  const deleteExample = (propertyIndex: number, exampleId: string) => {
    const property = formData.properties[propertyIndex];
    updateProperty(propertyIndex, {
      examples: (property.examples || []).filter(
        (ex: any) => ex.id !== exampleId
      )
    });
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof SchemaFormData, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    }

    if (formData.version < 1) {
      newErrors.version = "Version must be at least 1";
    }

    if (formData.properties.length === 0) {
      newErrors.properties = "At least one property is required";
    } else {
      // Validate each property
      const validateProperty = (
        prop: SchemaProperty,
        path: string = "",
        isNested: boolean = false
      ): string | null => {
        const propPath = path
          ? `${path}.${prop.name}`
          : prop.name || "Unnamed field";

        // For nested fields, only name is required (title will be auto-generated)
        if (isNested) {
          if (!prop.name.trim()) {
            return `${propPath}: Nested field must have a name`;
          }
        } else {
          if (!prop.name.trim() || !prop.title.trim()) {
            return `${propPath}: All properties must have a name and title`;
          }
        }

        // Validate date fields have proper examples
        if (prop.type === "date" && prop.examples && prop.examples.length > 0) {
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          const hasInvalidDateExample = prop.examples.some(
            (ex: any) => ex.output && !dateRegex.test(ex.output)
          );
          if (hasInvalidDateExample) {
            return `${propPath}: Date field examples must be in YYYY-MM-DD format`;
          }
        }

        // Validate object lists have at least one field
        if (prop.type === "list" && prop.itemType === "object") {
          if (!prop.fields || prop.fields.length === 0) {
            return `${propPath}: Object lists must have at least one field defined`;
          }

          // Validate nested fields
          for (const field of prop.fields) {
            // Validate nested fields don't contain object lists
            if (field.type === "list" && field.itemType === "object") {
              return `${propPath}.${field.name}: Nested fields cannot contain object lists (only one level of nesting supported)`;
            }

            // Recursively validate nested fields (pass isNested=true)
            const nestedError = validateProperty(field, propPath, true);
            if (nestedError) {
              return nestedError;
            }
          }
        }

        return null;
      };

      for (const prop of formData.properties) {
        const error = validateProperty(prop);
        if (error) {
          newErrors.properties = error;
          break;
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(formData);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Step Navigation */}
      <div className="border-b border-border bg-card rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentStep("schema")}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all ${
              currentStep === "schema"
                ? "bg-primary text-primary-foreground shadow-lg"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            <FileText className="h-5 w-5" />
            <div className="text-left">
              <div className="text-sm font-medium">Step 1</div>
              <div className="text-xs opacity-90">Schema Definition</div>
            </div>
          </button>

          <ChevronRight className="h-5 w-5 text-muted-foreground" />

          <button
            type="button"
            onClick={() => setCurrentStep("agents")}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all ${
              currentStep === "agents"
                ? "bg-primary text-primary-foreground shadow-lg"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            <Bot className="h-5 w-5" />
            <div className="text-left">
              <div className="text-sm font-medium">Step 2</div>
              <div className="text-xs opacity-90">Agent Pipeline</div>
            </div>
          </button>
        </div>
      </div>

      {/* Step 1: Schema Definition */}
      {currentStep === "schema" && (
        <>
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full"
          >
            <div className="border-b">
              <div className="flex items-center justify-between gap-4 pb-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold">Fields to Extract</h2>
                  <p className="text-sm text-muted-foreground">
                    Configure general instructions and define each field you
                    want to extract
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={addProperty}
                  size="sm"
                  className="shrink-0"
                  disabled={isSubmitting}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Field
                </Button>
              </div>

              <div className="relative">
                <div className="overflow-x-auto overflow-y-hidden">
                  <TabsList className="inline-flex h-auto w-auto min-w-full justify-start gap-1 rounded-none border-b-0 bg-transparent p-0">
                    <TabsTrigger
                      value="general"
                      className="relative shrink-0 rounded-t-md border-b-2 border-transparent bg-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-muted/30 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    >
                      General Instructions
                    </TabsTrigger>
                    {formData.properties.map((property, index) => (
                      <div key={index} className="relative group">
                        <TabsTrigger
                          value={`property-${index}`}
                          className="shrink-0 rounded-t-md border-b-2 border-transparent bg-transparent px-4 py-2.5 pr-9 text-sm font-medium text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-muted/30 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                        >
                          <span className="truncate">
                            {property.title ||
                              property.name ||
                              `Field ${index + 1}`}
                            {property.required && (
                              <span className="ml-1 text-destructive">*</span>
                            )}
                          </span>
                        </TabsTrigger>
                        <button
                          type="button"
                          className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-sm p-0 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 flex items-center justify-center z-10"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDeleteProperty(index);
                          }}
                          disabled={isSubmitting}
                          aria-label="Delete field"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </TabsList>
                </div>
              </div>
            </div>

            {/* General Instructions Tab */}
            <TabsContent value="general" className="mt-0 p-6 space-y-6">
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="schema-name">
                      Schema Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="schema-name"
                      placeholder="e.g., Invoice Extraction"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      disabled={isSubmitting}
                      required
                    />
                    {errors.name && (
                      <p className="text-sm text-destructive">{errors.name}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="version">
                      Version <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="version"
                      type="number"
                      min="1"
                      placeholder="1"
                      value={formData.version}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          version: parseInt(e.target.value) || 1
                        })
                      }
                      disabled={isSubmitting || !!initialData?.version}
                      required
                    />
                    {errors.version && (
                      <p className="text-sm text-destructive">
                        {errors.version}
                      </p>
                    )}
                  </div>
                </div>

                {initialData?.version && (
                  <div className="space-y-2">
                    <Label htmlFor="change-description">
                      Change Description
                    </Label>
                    <Input
                      id="change-description"
                      value={formData.changeDescription}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          changeDescription: e.target.value
                        })
                      }
                      placeholder="Describe what changed in this version..."
                      disabled={isSubmitting}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="general-instructions">
                      Overall Extraction Guidance (Optional)
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {formData.prompt.length}/2000
                    </span>
                  </div>
                  <Textarea
                    id="general-instructions"
                    placeholder="e.g., Extract information from invoices. Focus on accuracy for financial data. If a field is not found, leave it empty rather than guessing..."
                    value={formData.prompt}
                    onChange={(e) => {
                      const value = e.target.value.slice(0, 2000);
                      setFormData({ ...formData, prompt: value });
                    }}
                    rows={6}
                    className="resize-none"
                    disabled={isSubmitting}
                    maxLength={2000}
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum 2000 characters for optimal AI processing
                  </p>
                </div>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <strong>Tip:</strong> Be specific about extraction rules,
                    data formatting, and how to handle missing information.
                    These instructions apply to all fields.
                  </AlertDescription>
                </Alert>
              </div>
            </TabsContent>

            {/* Property Tabs */}
            {formData.properties.map((property, index) => (
              <TabsContent
                key={index}
                value={`property-${index}`}
                className="mt-0 p-6 space-y-6"
              >
                {/* Field Definition */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Field Definition</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => confirmDeleteProperty(index)}
                      disabled={isSubmitting}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Field
                    </Button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`display-name-${index}`}>
                        Display Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id={`display-name-${index}`}
                        placeholder="e.g., Invoice Number"
                        value={property.title}
                        onChange={(e) =>
                          updateProperty(index, { title: e.target.value })
                        }
                        disabled={isSubmitting}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`field-name-${index}`}>
                        Field Name (for code){" "}
                        <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id={`field-name-${index}`}
                        placeholder="e.g., invoiceNumber"
                        value={property.name}
                        onChange={(e) =>
                          updateProperty(index, { name: e.target.value })
                        }
                        disabled={isSubmitting}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`description-${index}`}>Description</Label>
                    <Textarea
                      id={`description-${index}`}
                      placeholder="What is this field? e.g., The unique identifier for the invoice"
                      value={property.description}
                      onChange={(e) =>
                        updateProperty(index, { description: e.target.value })
                      }
                      rows={2}
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor={`data-type-${index}`}>Data Type</Label>
                      <Select
                        value={property.type}
                        onValueChange={(value) => {
                          const updates: Partial<SchemaProperty> = {
                            type: value as any
                          };

                          // Initialize itemType when changing to list
                          if (value === "list" && property.type !== "list") {
                            updates.itemType = "string";
                          }

                          // When changing from list to non-list, we need to remove itemType and fields
                          // With exactOptionalPropertyTypes, we can't set to undefined
                          // Instead, we'll handle this by creating a new property without those fields
                          if (property.type === "list" && value !== "list") {
                            // Create a new property without itemType and fields
                            const { itemType, fields, ...rest } = property;
                            updateProperty(index, { ...rest, ...updates });
                          } else {
                            updateProperty(index, updates);
                          }
                        }}
                        disabled={isSubmitting ?? false}
                      >
                        <SelectTrigger id={`data-type-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="string">Text</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                          <SelectItem value="date">Date</SelectItem>
                          <SelectItem value="boolean">Yes/No</SelectItem>
                          <SelectItem value="list">List</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`importance-${index}`}>Importance</Label>
                      <Select
                        value={property.importance || "medium"}
                        onValueChange={(value) =>
                          updateProperty(index, {
                            importance: value as "high" | "medium" | "low"
                          })
                        }
                        disabled={isSubmitting ?? false}
                      >
                        <SelectTrigger id={`importance-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-end space-y-2">
                      <label className="flex items-center gap-2">
                        <Checkbox
                          id={`required-${index}`}
                          checked={property.required}
                          onCheckedChange={(checked) =>
                            updateProperty(index, {
                              required: checked === true
                            })
                          }
                          className="h-4 w-4 rounded border-input"
                          disabled={isSubmitting}
                        />
                        <span className="text-sm font-medium">
                          Required field
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Item Type Selector for List Properties */}
                  {property.type === "list" && (
                    <div className="space-y-2">
                      <Label htmlFor={`item-type-${index}`}>
                        List Item Type
                      </Label>
                      <Select
                        value={property.itemType || "string"}
                        onValueChange={(value) => {
                          const updates: Partial<SchemaProperty> = {
                            itemType: value as any
                          };

                          // Initialize fields array when switching to object
                          if (value === "object" && !property.fields) {
                            updates.fields = [];
                          }

                          // Clear fields when switching away from object
                          // With exactOptionalPropertyTypes, we can't set to undefined
                          // Instead, we'll create a new property without the fields property
                          if (value !== "object" && property.fields) {
                            const { fields, ...rest } = property;
                            updateProperty(index, { ...rest, ...updates });
                          } else {
                            updateProperty(index, updates);
                          }
                        }}
                        disabled={isSubmitting ?? false}
                      >
                        <SelectTrigger id={`item-type-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="string">Text</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                          <SelectItem value="date">Date</SelectItem>
                          <SelectItem value="boolean">Yes/No</SelectItem>
                          <SelectItem value="object">
                            Object (Structured)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {property.type === "list" &&
                        property.itemType === "object"
                          ? "Each item in the list will be a structured object with multiple fields"
                          : "Each item in the list will be a single value"}
                      </p>
                    </div>
                  )}
                </div>

                {/* Nested Field Editor for Object Lists */}
                {property.type === "list" && property.itemType === "object" && (
                  <div className="space-y-4 border-t pt-6">
                    <NestedFieldEditor
                      fields={property.fields || []}
                      onFieldsChange={(fields) =>
                        updateProperty(index, { fields })
                      }
                      disabled={isSubmitting}
                    />
                  </div>
                )}

                {/* Extraction Instructions */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="font-medium">Extraction Instructions</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`extraction-instructions-${index}`}>
                        How should the AI extract this field?
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {(property.extractionInstructions || "").length}/500
                      </span>
                    </div>
                    <Textarea
                      id={`extraction-instructions-${index}`}
                      placeholder="e.g., Look for the invoice number at the top right of the document. It usually starts with 'INV-' followed by numbers. If multiple numbers are present, use the one labeled 'Invoice #'."
                      value={property.extractionInstructions || ""}
                      onChange={(e) => {
                        const value = e.target.value.slice(0, 500);
                        updateProperty(index, {
                          extractionInstructions: value
                        });
                      }}
                      rows={4}
                      disabled={isSubmitting}
                      maxLength={500}
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum 500 characters. Be specific about where to find
                      this information and how to handle edge cases
                    </p>
                  </div>
                </div>

                {/* Examples */}
                <div className="space-y-4 border-t pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Examples</h3>
                      <p className="text-sm text-muted-foreground">
                        Show the AI what correct extractions look like
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addExample(index)}
                      disabled={isSubmitting}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Example
                    </Button>
                  </div>

                  {!property.examples || property.examples.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        No examples yet. Add examples to improve extraction
                        accuracy.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {property.examples.map(
                        (example: any, exIndex: number) => (
                          <div
                            key={example.id}
                            className="rounded-lg border bg-muted/30 p-4"
                          >
                            <div className="mb-3 flex items-center justify-between">
                              <span className="text-sm font-medium">
                                Example {exIndex + 1}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteExample(index, example.id)}
                                disabled={isSubmitting}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`example-input-${example.id}`}
                                  className="text-xs"
                                >
                                  Document Text
                                </Label>
                                <Textarea
                                  id={`example-input-${example.id}`}
                                  placeholder="e.g., Invoice #: INV-2024-001"
                                  value={example.input}
                                  onChange={(e) =>
                                    updateExample(index, example.id, {
                                      input: e.target.value
                                    })
                                  }
                                  rows={2}
                                  className="text-sm"
                                  disabled={isSubmitting}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`example-output-${example.id}`}
                                  className="text-xs"
                                >
                                  Expected Output
                                </Label>
                                <Textarea
                                  id={`example-output-${example.id}`}
                                  placeholder="e.g., INV-2024-001"
                                  value={example.output}
                                  onChange={(e) =>
                                    updateExample(index, example.id, {
                                      output: e.target.value
                                    })
                                  }
                                  rows={2}
                                  className="text-sm"
                                  disabled={isSubmitting}
                                />
                              </div>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>

          <div className="flex justify-between gap-3 border-t pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => setCurrentStep("agents")}
              disabled={!formData.name || formData.properties.length === 0}
              className="gap-2"
            >
              Continue to Agent Pipeline
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {currentStep === "agents" && (
        <div className="space-y-6">
          <PostProcessingAgentsSection
            agents={formData.agents || []}
            onChange={(agents) => setFormData({ ...formData, agents })}
            schemaProperties={formData.properties.map((p) => p.name)}
          />

          {/* Step 2 Footer Actions */}
          <div className="flex justify-between gap-3 border-t pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentStep("schema")}
              disabled={isSubmitting}
            >
              ← Back to Schema
            </Button>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !formData.name ||
                  formData.properties.length === 0 ||
                  isSubmitting
                }
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {isSubmitting ? "Saving..." : submitText}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Property Confirmation Dialog */}
      <ConfirmationDialog
        open={propertyToDelete !== null}
        onOpenChange={(open) => {
          if (!open) cancelDeleteProperty();
        }}
        title="Delete Field"
        description={
          propertyToDelete !== null
            ? `Are you sure you want to delete "${
                formData.properties[propertyToDelete]?.title ||
                formData.properties[propertyToDelete]?.name ||
                "this field"
              }"? This action cannot be undone.`
            : ""
        }
        confirmText="Delete"
        onConfirm={deleteProperty}
        isLoading={false}
        isDestructive={true}
      />
    </form>
  );
}
