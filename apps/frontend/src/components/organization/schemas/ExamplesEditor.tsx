
import { useState } from "react";
import { Badge, Button, Input } from "@packages/ui";
import type { SchemaProperty } from "@packages/types";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

interface ExamplesEditorProps {
  examples: Record<string, any>[];
  properties: SchemaProperty[];
  onChange: (examples: Record<string, any>[]) => void;
}

export function ExamplesEditor({
  examples,
  properties,
  onChange
}: ExamplesEditorProps) {
  const [expandedExamples, setExpandedExamples] = useState<Set<number>>(
    new Set(examples.map((_, i) => i))
  );

  const addExample = () => {
    const newExample: Record<string, any> = {};
    properties.forEach((prop) => {
      if (prop.type === "string") newExample[prop.name] = "";
      else if (prop.type === "number") newExample[prop.name] = 0;
      else if (prop.type === "boolean") newExample[prop.name] = false;
      else if (prop.type === "list") newExample[prop.name] = [];
      else newExample[prop.name] = {};
    });
    onChange([...examples, newExample]);
    setExpandedExamples(new Set([...expandedExamples, examples.length]));
  };

  const removeExample = (index: number) => {
    onChange(examples.filter((_, i) => i !== index));
    const newExpanded = new Set(expandedExamples);
    newExpanded.delete(index);
    setExpandedExamples(newExpanded);
  };

  const updateExample = (index: number, field: string, value: any) => {
    onChange(
      examples.map((ex, i) => (i === index ? { ...ex, [field]: value } : ex))
    );
  };

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedExamples);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedExamples(newExpanded);
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "string":
        return "bg-blue-500/10 text-blue-700 dark:text-blue-400";
      case "number":
        return "bg-green-500/10 text-green-700 dark:text-green-400";
      case "boolean":
        return "bg-purple-500/10 text-purple-700 dark:text-purple-400";
      case "list":
        return "bg-orange-500/10 text-orange-700 dark:text-orange-400";
      case "map":
        return "bg-gray-500/10 text-gray-700 dark:text-gray-400";
      default:
        return "bg-gray-500/10 text-gray-700 dark:text-gray-400";
    }
  };

  if (properties.length === 0) {
    return (
      <div className="space-y-2">
        <div className="text-center py-12 border-2 border-dashed rounded-lg bg-muted/30">
          <p className="text-sm text-muted-foreground">
            Define properties first before adding examples
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Example Extractions
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Provide examples to help the AI understand the expected output
            format
          </p>
        </div>
        <Button type="button" onClick={addExample} size="sm" variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          Add Example
        </Button>
      </div>

      {examples.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg bg-muted/30">
          <p className="text-sm text-muted-foreground mb-4">
            No examples defined yet. Add example extractions to improve AI
            accuracy.
          </p>
          <Button type="button" onClick={addExample} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Add Example
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {examples.map((example, exIndex) => (
            <div
              key={exIndex}
              className="border border-border rounded-lg overflow-hidden"
            >
              {/* Example Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-muted/50 border-b border-border">
                <button
                  type="button"
                  onClick={() => toggleExpanded(exIndex)}
                  className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                >
                  {expandedExamples.has(exIndex) ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  Example {exIndex + 1}
                </button>
                <button
                  type="button"
                  onClick={() => removeExample(exIndex)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Example Content - Table Format */}
              {expandedExamples.has(exIndex) && (
                <div className="p-4">
                  <div className="overflow-x-auto">
                    <div className="border border-border rounded-lg overflow-hidden min-w-max">
                      {/* Table Header */}
                      <div
                        className="grid gap-px"
                        style={{
                          gridTemplateColumns: `repeat(${properties.length}, minmax(150px, 1fr))`
                        }}
                      >
                        {properties.map((prop) => (
                          <div
                            key={prop.name}
                            className="bg-muted/50 px-3 py-2"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-muted-foreground uppercase">
                                {prop.title}
                                {prop.required && (
                                  <span className="text-destructive ml-1">
                                    *
                                  </span>
                                )}
                              </span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1 py-0 h-4 ${getTypeColor(prop.type)}`}
                              >
                                {prop.type}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Table Body */}
                      <div
                        className="grid gap-px"
                        style={{
                          gridTemplateColumns: `repeat(${properties.length}, minmax(150px, 1fr))`
                        }}
                      >
                        {properties.map((prop) => (
                          <div
                            key={prop.name}
                            className="bg-muted/20 px-3 py-2"
                          >
                            {prop.type === "boolean" ? (
                              <select
                                value={String(example[prop.name] || false)}
                                onChange={(e) =>
                                  updateExample(
                                    exIndex,
                                    prop.name,
                                    e.target.value === "true"
                                  )
                                }
                                className="w-full h-9 rounded-md border border-input bg-muted/20 px-3 text-sm"
                              >
                                <option value="false">False</option>
                                <option value="true">True</option>
                              </select>
                            ) : (
                              <Input
                                type={
                                  prop.type === "number" ? "number" : "text"
                                }
                                value={example[prop.name] || ""}
                                onChange={(e) =>
                                  updateExample(
                                    exIndex,
                                    prop.name,
                                    prop.type === "number"
                                      ? parseFloat(e.target.value) || 0
                                      : e.target.value
                                  )
                                }
                                className={`h-9 bg-muted/20 ${
                                  prop.type === "number" ? "font-mono" : ""
                                }`}
                                placeholder={prop.description || "..."}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
