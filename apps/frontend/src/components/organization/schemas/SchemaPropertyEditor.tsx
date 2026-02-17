import type { SchemaProperty } from "@packages/types";
import {
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@packages/ui";
import { GripVertical, Plus, Trash2 } from "lucide-react";

interface SchemaPropertyEditorProps {
  properties: SchemaProperty[];
  onChange: (properties: SchemaProperty[]) => void;
}

export function SchemaPropertyEditor({
  properties,
  onChange
}: SchemaPropertyEditorProps) {
  const addProperty = () => {
    onChange([
      ...properties,
      {
        name: "",
        type: "string",
        title: "",
        description: "",
        priority: "medium",
        required: false
      }
    ]);
  };

  const removeProperty = (index: number) => {
    onChange(properties.filter((_, i) => i !== index));
  };

  const updateProperty = (index: number, updates: Partial<SchemaProperty>) => {
    onChange(
      properties.map((prop, i) => {
        if (i !== index) return prop;

        // Merge updates with existing property
        const merged = { ...prop, ...updates };

        // Remove optional properties when type changes away from "list"
        if (updates.type !== undefined && updates.type !== "list") {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { itemType: _itemType, fields: _fields, ...rest } = merged;
          return rest as SchemaProperty;
        }

        // Remove fields when itemType changes away from "object"
        if (updates.itemType !== undefined && updates.itemType !== "object") {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { fields: _fields, ...rest } = merged;
          return rest as SchemaProperty;
        }

        return merged;
      })
    );
  };

  const addNestedField = (parentIndex: number) => {
    const next = [...properties];
    const parent = next[parentIndex];
    const fields = parent.fields ? [...parent.fields] : [];
    fields.push({
      name: "",
      type: "string",
      title: "",
      description: "",
      priority: "medium",
      required: false
    });
    next[parentIndex] = { ...parent, fields };
    onChange(next);
  };

  const removeNestedField = (parentIndex: number, childIndex: number) => {
    const next = [...properties];
    const parent = next[parentIndex];
    if (!parent.fields) return;
    const fields = parent.fields.filter((_, i) => i !== childIndex);
    next[parentIndex] = { ...parent, fields };
    onChange(next);
  };

  const updateNestedField = (
    parentIndex: number,
    childIndex: number,
    updates: Partial<SchemaProperty>
  ) => {
    const next = [...properties];
    const parent = next[parentIndex];
    if (!parent.fields) return;

    const fields = parent.fields.map((f, i) => {
      if (i !== childIndex) return f;

      // Merge updates with existing field
      const merged = { ...f, ...updates };

      // Remove optional properties when type changes away from "list"
      if (updates.type !== undefined && updates.type !== "list") {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { itemType: _itemType, fields: _fields, ...rest } = merged;
        return rest as SchemaProperty;
      }

      return merged;
    });

    next[parentIndex] = { ...parent, fields };
    onChange(next);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "text-red-600 dark:text-red-400";
      case "medium":
        return "text-yellow-600 dark:text-yellow-400";
      case "low":
        return "text-green-600 dark:text-green-400";
      default:
        return "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Extraction Properties
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Define the data fields to extract from documents
          </p>
        </div>
        <Button type="button" onClick={addProperty} size="sm" variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          Add Property
        </Button>
      </div>

      {properties.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg bg-muted/30">
          <p className="text-sm text-muted-foreground mb-4">
            No properties defined yet. Add your first extraction property.
          </p>
          <Button
            type="button"
            onClick={addProperty}
            variant="outline"
            size="sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Property
          </Button>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[40px_1fr_120px_1fr_120px_60px_60px] gap-4 px-4 py-3 bg-muted/50 border-b border-border sticky top-0">
            <div></div>
            <div className="text-xs font-medium text-muted-foreground uppercase">
              Name
            </div>
            <div className="text-xs font-medium text-muted-foreground uppercase">
              Type
            </div>
            <div className="text-xs font-medium text-muted-foreground uppercase">
              Title
            </div>
            <div className="text-xs font-medium text-muted-foreground uppercase">
              Priority
            </div>
            <div className="text-xs font-medium text-muted-foreground uppercase text-center">
              Req
            </div>
            <div></div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-border">
            {properties.map((property, index) => (
              <div key={index} className="hover:bg-muted/20 transition-colors">
                {/* Main Row */}
                <div className="grid grid-cols-[40px_1fr_120px_1fr_120px_60px_60px] gap-4 px-4 py-3 items-center">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
                  >
                    <GripVertical className="w-4 h-4" />
                  </button>
                  <Input
                    value={property.name}
                    onChange={(e) =>
                      updateProperty(index, { name: e.target.value })
                    }
                    placeholder="propertyName"
                    className="h-9 font-mono text-sm bg-muted/20"
                  />
                  <Select
                    value={property.type}
                    onValueChange={(value: SchemaProperty["type"]) => {
                      if (value === "list") {
                        const updates: Partial<SchemaProperty> = {
                          type: value,
                          itemType: property.itemType || "string"
                        };
                        if (property.itemType === "object" && property.fields) {
                          updates.fields = property.fields;
                        }
                        updateProperty(index, updates);
                      } else {
                        // Omit optional properties when type is not "list"
                        const updates: Partial<SchemaProperty> = {
                          type: value
                        };
                        updateProperty(index, updates);
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 bg-muted/20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="string">String</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="boolean">Boolean</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="list">List</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    {property.type === "list" && (
                      <Select
                        value={property.itemType || "string"}
                        onValueChange={(
                          value:
                            | "string"
                            | "number"
                            | "boolean"
                            | "date"
                            | "object"
                        ) => {
                          const updates: Partial<SchemaProperty> = {
                            itemType: value
                          };
                          if (value === "object") {
                            updates.fields = property.fields || [];
                          }
                          updateProperty(index, updates);
                        }}
                      >
                        <SelectTrigger className="h-9 bg-muted/20 min-w-[110px]">
                          <SelectValue placeholder="Item type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="string">String</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                          <SelectItem value="boolean">Boolean</SelectItem>
                          <SelectItem value="date">Date</SelectItem>
                          <SelectItem value="object">Object</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    <Input
                      value={property.title}
                      onChange={(e) =>
                        updateProperty(index, { title: e.target.value })
                      }
                      placeholder="Display Title"
                      className="h-9 bg-muted/20"
                    />
                  </div>
                  <Select
                    value={property.priority}
                    onValueChange={(value: SchemaProperty["priority"]) =>
                      updateProperty(index, { priority: value })
                    }
                  >
                    <SelectTrigger
                      className={`h-9 bg-muted/20 ${getPriorityColor(property.priority)}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={property.required}
                      onCheckedChange={(checked) =>
                        updateProperty(index, {
                          required: checked as boolean
                        })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeProperty(index)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Description Row */}
                <div className="grid grid-cols-[40px_1fr] gap-4 px-4 pb-3">
                  <div></div>
                  <Input
                    value={property.description}
                    onChange={(e) =>
                      updateProperty(index, {
                        description: e.target.value
                      })
                    }
                    placeholder="Description"
                    className="h-8 text-sm bg-muted/20"
                  />
                </div>

                {/* Nested Fields for Object Lists */}
                {property.type === "list" && property.itemType === "object" && (
                  <div className="px-4 pb-4">
                    <div className="ml-[40px] border rounded-md overflow-hidden">
                      {/* Nested header */}
                      <div className="grid grid-cols-[1fr_120px_1fr_120px_60px_60px] gap-3 px-3 py-2 bg-muted/30 border-b">
                        <div className="text-[10px] uppercase text-muted-foreground font-medium">
                          Field Name
                        </div>
                        <div className="text-[10px] uppercase text-muted-foreground font-medium">
                          Type
                        </div>
                        <div className="text-[10px] uppercase text-muted-foreground font-medium">
                          Title
                        </div>
                        <div className="text-[10px] uppercase text-muted-foreground font-medium">
                          Priority
                        </div>
                        <div className="text-[10px] uppercase text-muted-foreground font-medium text-center">
                          Req
                        </div>
                        <div />
                      </div>
                      {/* Nested rows */}
                      <div className="divide-y">
                        {(property.fields || []).map((field, childIdx) => (
                          <div key={childIdx}>
                            <div className="grid grid-cols-[1fr_120px_1fr_120px_60px_60px] gap-3 px-3 py-2 items-center">
                              <Input
                                value={field.name}
                                onChange={(e) =>
                                  updateNestedField(index, childIdx, {
                                    name: e.target.value
                                  })
                                }
                                placeholder="fieldName"
                                className="h-8 font-mono text-xs bg-muted/20"
                              />
                              <Select
                                value={field.type}
                                onValueChange={(
                                  value: SchemaProperty["type"]
                                ) => {
                                  if (value === "list") {
                                    const updates: Partial<SchemaProperty> = {
                                      type: value,
                                      itemType: field.itemType || "string"
                                    };
                                    updateNestedField(index, childIdx, updates);
                                  } else {
                                    // Omit optional properties when type is not "list"
                                    updateNestedField(index, childIdx, {
                                      type: value
                                    });
                                  }
                                }}
                              >
                                <SelectTrigger className="h-8 bg-muted/20">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="string">String</SelectItem>
                                  <SelectItem value="number">Number</SelectItem>
                                  <SelectItem value="boolean">
                                    Boolean
                                  </SelectItem>
                                  <SelectItem value="list">List</SelectItem>
                                </SelectContent>
                              </Select>
                              <div className="flex items-center gap-2">
                                {field.type === "list" && (
                                  <Select
                                    value={field.itemType || "string"}
                                    onValueChange={(
                                      value:
                                        | "string"
                                        | "number"
                                        | "boolean"
                                        | "date"
                                    ) =>
                                      updateNestedField(index, childIdx, {
                                        itemType: value
                                      })
                                    }
                                  >
                                    <SelectTrigger className="h-8 bg-muted/20 min-w-[95px]">
                                      <SelectValue placeholder="Item" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="string">
                                        String
                                      </SelectItem>
                                      <SelectItem value="number">
                                        Number
                                      </SelectItem>
                                      <SelectItem value="boolean">
                                        Boolean
                                      </SelectItem>
                                      <SelectItem value="date">Date</SelectItem>
                                    </SelectContent>
                                  </Select>
                                )}
                                <Input
                                  value={field.title}
                                  onChange={(e) =>
                                    updateNestedField(index, childIdx, {
                                      title: e.target.value
                                    })
                                  }
                                  placeholder="Title"
                                  className="h-8 text-xs bg-muted/20"
                                />
                              </div>
                              <Select
                                value={field.priority}
                                onValueChange={(
                                  value: SchemaProperty["priority"]
                                ) =>
                                  updateNestedField(index, childIdx, {
                                    priority: value
                                  })
                                }
                              >
                                <SelectTrigger
                                  className={`h-8 bg-muted/20 ${getPriorityColor(field.priority)}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="low">Low</SelectItem>
                                  <SelectItem value="medium">Med</SelectItem>
                                  <SelectItem value="high">High</SelectItem>
                                </SelectContent>
                              </Select>
                              <div className="flex justify-center">
                                <Checkbox
                                  checked={field.required}
                                  onCheckedChange={(checked) =>
                                    updateNestedField(index, childIdx, {
                                      required: checked as boolean
                                    })
                                  }
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  removeNestedField(index, childIdx)
                                }
                                className="text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {/* Nested field description */}
                            <div className="grid grid-cols-[1fr_120px_1fr_120px_60px_60px] gap-3 px-3 pb-2">
                              <Input
                                value={field.description}
                                onChange={(e) =>
                                  updateNestedField(index, childIdx, {
                                    description: e.target.value
                                  })
                                }
                                placeholder="Description"
                                className="col-span-4 h-7 text-xs bg-muted/20"
                              />
                            </div>
                          </div>
                        ))}
                        <div className="px-3 py-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => addNestedField(index)}
                            className="h-7 text-xs"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add field
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Info for List type */}
                {property.type === "list" && (
                  <div className="px-4 pb-3 ml-[40px] text-xs text-muted-foreground">
                    Array of{" "}
                    <span className="font-mono">
                      {property.itemType || "string"}
                    </span>{" "}
                    values
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
