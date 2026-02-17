import { useState } from "react";
import type {
  AgentExecutionMetadata as AgentMetadata,
  ExtractionResultStatus,
  SchemaProperty,
  Supplier
} from "@packages/types";
import { UNIT_OPTIONS } from "@packages/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@packages/ui";
import { Check, Eye, EyeOff, MoreHorizontal, Trash2 } from "lucide-react";
import {
  DataComparison,
  EditableField,
  OptionSelector
} from "@/components/common";
import { AgentExecutionMetadata } from "./AgentExecutionMetadata";

// Supplier match interface
export interface SupplierMatchData {
  id: string;
  supplierId: string;
  confidenceScore: number | null;
  matchReason: string | null;
  isSelected: boolean;
  supplier: Supplier;
}

// Flexible extraction result interface based on @packages/utils design
export interface FlexibleExtractionResult {
  id: string;
  extractionJobId: string;
  rawExtraction: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  verifiedData?: Record<string, unknown> | null;
  status: ExtractionResultStatus;
  confidenceScore?: number;
  pageNumber?: number;
  locationInDoc?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  verificationNotes?: string;
  editedBy?: string;
  editedAt?: string;
  createdAt: string;
  updatedAt: string;
  originalSnippet?: string;
  agentExecutionMetadata?: AgentMetadata[];
  initialResults?: Record<string, unknown>;
  supplierMatches?: SupplierMatchData[];
  [key: string]: unknown;
}

interface ExtractionRowProps {
  material: FlexibleExtractionResult;
  schema?: SchemaProperty[];
  readOnly?: boolean;
  editingCell?: { id: string; field: string } | null;
  editValue?: string;
  onStartEdit?: (id: string, field: string, currentValue: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  onUpdateStatus?: (status: ExtractionResultStatus) => void;
  onEditValueChange?: (value: string) => void;
  rawData?: Record<string, unknown> | undefined;
  isSelected?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  onDelete?: (id: string) => void;
  onSelectSupplier?: (resultId: string, supplierId: string) => void;
  isSelectingSupplier?: boolean;
  highlighted?: boolean;
}

export function ExtractionRow({
  material,
  schema,
  readOnly = false,
  editingCell,
  editValue,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onUpdateStatus,
  onEditValueChange,
  rawData,
  isSelected = false,
  onSelect,
  onDelete,
  onSelectSupplier,
  isSelectingSupplier = false,
  highlighted = false
}: ExtractionRowProps) {
  const [showComparison, setShowComparison] = useState(false);

  // Get supplier matches and selected supplier
  const supplierMatches = material.supplierMatches || [];
  const selectedMatch = supplierMatches.find((m) => m.isSelected);
  const hasMatches = supplierMatches.length > 0;
  const selectedSupplierId =
    selectedMatch?.supplierId || selectedMatch?.supplier?.id;

  // Helper function to determine field type for EditableField component
  const getFieldType = (
    schemaProp: SchemaProperty
  ): "input" | "textarea" | "number" | "select" => {
    if (schemaProp.type === "number") return "number";
    if (schemaProp.type === "boolean") return "select";
    if (schemaProp.name === "unit") return "select"; // Special case for units
    // Could add more heuristics based on field name or schema metadata
    return "input";
  };

  // Helper function to get field value from raw data (flexible structure)
  const getRawFieldValue = (fieldName: string): string => {
    if (!rawData) return "";
    const value = rawData[fieldName];
    return String(value || "").trim();
  };

  // Helper function to get current field value from flexible structure
  const getCurrentFieldValue = (fieldName: string): string => {
    // Compute effectiveData: merge verified with raw
    const rawData = (material.rawExtraction as Record<string, unknown>) || {};
    const verifiedData =
      (material.verifiedData as Record<string, unknown>) || {};
    const effectiveData = { ...rawData, ...verifiedData };

    const value = effectiveData[fieldName] || material[fieldName];
    return String(value || "").trim();
  };

  // Helper function to render data field based on schema property
  const renderSchemaField = (schemaProp: SchemaProperty) => {
    const fieldName = schemaProp.name;
    const label = schemaProp.title || fieldName;
    const fieldType = getFieldType(schemaProp);

    const isEditing =
      !readOnly &&
      editingCell?.id === material.id &&
      editingCell?.field === fieldName;
    const currentValue = getCurrentFieldValue(fieldName);
    const rawValue = getRawFieldValue(fieldName);

    // Show comparison if we're in comparison mode and the values are different
    const shouldShowComparison =
      showComparison && rawValue !== currentValue && (rawValue || currentValue);

    if (shouldShowComparison) {
      return (
        <div key={fieldName} className="space-y-1">
          <label className="text-xs text-muted-foreground">{label}</label>
          <DataComparison original={rawValue} edited={currentValue} />
        </div>
      );
    }

    // Read-only mode or no comparison
    if (readOnly || showComparison) {
      return (
        <div key={fieldName} className="space-y-1">
          <label className="text-xs text-muted-foreground">{label}</label>
          <div className="text-xs p-2 bg-muted/50 rounded border">
            {currentValue}
          </div>
        </div>
      );
    }

    // Editable mode
    return (
      <div key={fieldName} className="space-y-1">
        <label className="text-xs text-muted-foreground">{label}</label>
        <EditableField
          label=""
          value={currentValue}
          isEditing={isEditing}
          editValue={editValue || ""}
          fieldType={fieldType}
          selectOptions={fieldType === "select" ? UNIT_OPTIONS : []}
          onStartEdit={() =>
            onStartEdit?.(material.id!, fieldName, currentValue)
          }
          onSaveEdit={onSaveEdit || (() => {})}
          onCancelEdit={onCancelEdit || (() => {})}
          onEditValueChange={onEditValueChange || (() => {})}
          rows={fieldType === "textarea" ? 2 : 1}
        />
      </div>
    );
  };

  // Filter out legacy fields and ID field from schema
  const filteredSchemaFields = (schema || []).filter((field) => {
    const fieldName = field.name.toLowerCase();
    const fieldTitle = (field.title || "").toLowerCase();

    // Exclude ID field
    if (fieldName === "id") return false;

    // Exclude any field with "legacy" in name or title
    if (fieldName.includes("legacy") || fieldTitle.includes("legacy"))
      return false;

    return true;
  });

  // Split schema fields into columns (for better layout)
  const schemaFields = filteredSchemaFields;
  const midPoint = Math.ceil(schemaFields.length / 2);
  const leftColumnFields = schemaFields.slice(0, midPoint);
  const rightColumnFields = schemaFields.slice(midPoint);

  return (
    <Card
      className={`mb-4 transition-all duration-200 ${
        highlighted
          ? "ring-2 ring-primary shadow-lg"
          : isSelected
            ? "ring-2 ring-primary ring-offset-2 shadow-lg bg-primary/5 border-primary/20"
            : readOnly
              ? ""
              : "hover:shadow-md hover:border-muted-foreground/30"
      }`}
    >
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header with selection, status, accept button, and comparison toggle */}
          {!readOnly && (
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center space-x-2">
                {onSelect && (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) =>
                      onSelect(material.id, Boolean(checked))
                    }
                  />
                )}
                <Badge
                  variant={
                    material.status === "pending" ? "secondary" : "default"
                  }
                  className={`${
                    material.status === "pending"
                      ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800"
                      : "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800"
                  } font-medium text-xs px-2 py-1`}
                >
                  {material.status === "accepted" ? "✓ Approved" : "⏳ Pending"}
                </Badge>
                {/* Supplier dropdown */}
                {hasMatches && onSelectSupplier && (
                  <OptionSelector
                    value={selectedSupplierId || ""}
                    label="Supplier:"
                    options={supplierMatches}
                    getDisplayText={(match) => match.supplier.name}
                    getOptionId={(match) =>
                      match.supplierId || match.supplier?.id
                    }
                    getSecondaryText={(match) =>
                      match.confidenceScore !== null
                        ? `${(match.confidenceScore * 100).toFixed(0)}%`
                        : null
                    }
                    onChange={(supplierId) => {
                      if (supplierId?.trim()) {
                        onSelectSupplier(material.id, supplierId);
                      }
                    }}
                    isLoading={isSelectingSupplier}
                    placeholder="Select supplier..."
                    loadingText="Updating..."
                  />
                )}
                {!hasMatches && onSelectSupplier && (
                  <span className="text-xs text-muted-foreground italic">
                    No supplier matches
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 bg-transparent h-7 px-2 text-xs"
                  onClick={() => {
                    const newStatus =
                      material.status === "pending" ? "accepted" : "pending";
                    onUpdateStatus?.(newStatus);
                  }}
                >
                  <Check className="h-3 w-3" />
                  {material.status === "pending" ? "Accept" : "Undo"}
                </Button>

                <div className="flex items-center space-x-1">
                  <Label
                    htmlFor={`comparison-${material.id}`}
                    className="text-xs"
                  >
                    Compare
                  </Label>
                  <Switch
                    id={`comparison-${material.id}`}
                    checked={showComparison}
                    onCheckedChange={setShowComparison}
                    className="h-4 w-7"
                  />
                  {showComparison ? (
                    <Eye className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <EyeOff className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>

                {onDelete && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => onDelete(material.id)}
                        className="text-destructive focus:text-destructive text-xs"
                      >
                        <Trash2 className="h-3 w-3 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          )}

          {/* Read-only header (simpler) */}
          {readOnly && (
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center space-x-2">
                <Badge
                  variant="outline"
                  className="font-medium text-xs px-2 py-1"
                >
                  Test Result
                </Badge>
                {material.pageNumber && (
                  <span className="text-xs text-muted-foreground">
                    Page {material.pageNumber}
                  </span>
                )}
              </div>
              {material.confidenceScore && (
                <span className="text-xs text-muted-foreground">
                  Confidence: {(material.confidenceScore * 100).toFixed(1)}%
                </span>
              )}
            </div>
          )}

          {/* Agent Execution Metadata */}
          {material.agentExecutionMetadata &&
            material.agentExecutionMetadata.length > 0 && (
              <AgentExecutionMetadata
                metadata={material.agentExecutionMetadata}
              />
            )}

          {/* Main content - with tabs if agents were used */}
          {material.agentExecutionMetadata &&
          material.agentExecutionMetadata.length > 0 &&
          material.initialResults ? (
            <Tabs defaultValue="final" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="final">Final Results</TabsTrigger>
                <TabsTrigger value="initial">Initial Results</TabsTrigger>
              </TabsList>

              <TabsContent value="final" className="mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Evidence Snippet */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Original Text
                    </h3>
                    <div className="bg-gradient-to-r from-blue-50/80 to-indigo-50/80 dark:from-blue-950/30 dark:to-indigo-950/30 p-3 rounded-lg border-l-4 border-blue-500/60 shadow-sm">
                      <pre className="text-xs whitespace-pre-wrap font-mono text-slate-700 dark:text-slate-300 leading-relaxed">
                        {material.originalSnippet ||
                          "No evidence snippet available"}
                      </pre>
                    </div>
                  </div>

                  {/* Extracted Data - Left Column */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Extracted Data (After Agents)
                    </h3>
                    <div className="space-y-3">
                      {leftColumnFields.map((field) =>
                        renderSchemaField(field)
                      )}
                    </div>
                  </div>

                  {/* Extracted Data - Right Column */}
                  {rightColumnFields.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Additional Fields
                      </h3>
                      <div className="space-y-3">
                        {rightColumnFields.map((field) =>
                          renderSchemaField(field)
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="initial" className="mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Evidence Snippet */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Original Text
                    </h3>
                    <div className="bg-gradient-to-r from-blue-50/80 to-indigo-50/80 dark:from-blue-950/30 dark:to-indigo-950/30 p-3 rounded-lg border-l-4 border-blue-500/60 shadow-sm">
                      <pre className="text-xs whitespace-pre-wrap font-mono text-slate-700 dark:text-slate-300 leading-relaxed">
                        {material.originalSnippet ||
                          "No evidence snippet available"}
                      </pre>
                    </div>
                  </div>

                  {/* Initial Results Display */}
                  <div className="lg:col-span-2 space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Initial Extraction (Before Agents)
                    </h3>
                    <div className="p-3 bg-muted/30 border border-border rounded-lg overflow-x-auto">
                      <pre className="text-xs font-mono whitespace-pre-wrap">
                        {JSON.stringify(material.initialResults, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            /* Standard view without agents */
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Evidence Snippet - Always shown */}
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Original Text
                </h3>
                <div className="bg-gradient-to-r from-blue-50/80 to-indigo-50/80 dark:from-blue-950/30 dark:to-indigo-950/30 p-3 rounded-lg border-l-4 border-blue-500/60 shadow-sm">
                  <pre className="text-xs whitespace-pre-wrap font-mono text-slate-700 dark:text-slate-300 leading-relaxed">
                    {material.originalSnippet ||
                      "No evidence snippet available"}
                  </pre>
                </div>
              </div>

              {/* Extracted Data - Left Column (schema-driven) */}
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Extracted Data
                </h3>
                <div className="space-y-3">
                  {leftColumnFields.map((field) => renderSchemaField(field))}
                </div>
              </div>

              {/* Extracted Data - Right Column (schema-driven) */}
              {rightColumnFields.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Additional Fields
                  </h3>
                  <div className="space-y-3">
                    {rightColumnFields.map((field) => renderSchemaField(field))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
