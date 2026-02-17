
import { useMemo, useState } from "react";
import type { SchemaProperty, Supplier } from "@packages/types";
import { Badge, Button, Card, Progress } from "@packages/ui";
import {
  Check,
  Clock,
  Copy,
  Globe,
  Mail,
  Package,
  TrendingUp
} from "lucide-react";
import { FieldSelectionDialog } from "@/components/common";
import type { FieldOption } from "@/components/common";
import { apiRequest } from "@/lib/api";

interface SupplierExtractionResult {
  id: string;
  data: Record<string, unknown>;
  jobId: string;
}

function formatFieldLabel(field: string): string {
  const withSpaces = field
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase();

  return withSpaces
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const DEFAULT_EMAIL_FIELDS = [
  "itemCode",
  "itemName",
  "technicalSpecifications",
  "quantity",
  "unit",
  "executionNotes"
] as const;

interface MetaFieldDefinition {
  key: string;
  label: string;
  accessor: (result: SupplierExtractionResult) => unknown;
}

const META_FIELD_DEFINITIONS: MetaFieldDefinition[] = [
  {
    key: "resultId",
    label: "Extraction Result ID",
    accessor: (result) => result.id
  },
  {
    key: "jobId",
    label: "Extraction Job ID",
    accessor: (result) => result.jobId
  }
];

interface SupplierCardProps {
  supplier: Supplier;
  matchedItems: number;
  totalProjectItems: number;
  matchPercentage: number;
  extractionResults: SupplierExtractionResult[];
  projectId: string;
  schemaPropertiesByJob?: Record<string, SchemaProperty[]>;
}

export function SupplierCard({
  supplier,
  matchedItems,
  totalProjectItems,
  matchPercentage,
  extractionResults,
  projectId,
  schemaPropertiesByJob
}: SupplierCardProps) {
  const [copied, setCopied] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);

  const generateEmail = {
    mutateAsync: async (data: {
      supplierId: string;
      projectId: string;
      extractionResultIds?: string[];
      dataFields?: string[];
      metaFields?: string[];
      selectedFields?: string[];
    }) => {
      setIsGeneratingEmail(true);
      try {
        const dataFields = data.dataFields || data.selectedFields || [];
        const metaFields = data.metaFields || [];

        // Build query parameters
        const queryParams = new URLSearchParams();
        if (dataFields.length > 0) {
          queryParams.append("dataFields", dataFields.join(","));
        }
        if (metaFields.length > 0) {
          queryParams.append("metaFields", metaFields.join(","));
        }

        const queryString =
          queryParams.size > 0 ? `?${queryParams.toString()}` : "";
        const endpoint = `/projects/${data.projectId}/suppliers/${data.supplierId}/email${queryString}`;

        const response = await apiRequest(endpoint);
        if (!response.ok) {
          throw new Error("Failed to generate email");
        }
        const result = await response.json();
        return typeof result === "string" ? result : result.emailText || "";
      } finally {
        setIsGeneratingEmail(false);
      }
    },
    isPending: isGeneratingEmail
  };

  const dataFieldOptions = useMemo<FieldOption[]>(() => {
    const labelLookup = new Map<string, string>();
    const orderMap = new Map<string, number>();
    let orderCounter = 0;

    extractionResults.forEach((result) => {
      const schemaFields =
        schemaPropertiesByJob?.[result.jobId]?.filter(
          (prop) => typeof prop?.name === "string"
        ) ?? [];

      if (schemaFields.length === 0) {
        return;
      }

      schemaFields.forEach((property) => {
        const key = property.name;
        if (!labelLookup.has(key)) {
          labelLookup.set(
            key,
            property.title || formatFieldLabel(property.name)
          );
          orderMap.set(key, orderCounter++);
        }
      });
    });

    if (labelLookup.size === 0) {
      const fallbackKeys = new Map<string, string>();

      extractionResults.forEach((result) => {
        Object.keys(result.data).forEach((key) => {
          if (!fallbackKeys.has(key)) {
            fallbackKeys.set(key, formatFieldLabel(key));
          }
        });
      });

      const sortedFallback = Array.from(fallbackKeys.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map<FieldOption>(([key, label]) => ({
          key,
          label
        }));

      return sortedFallback;
    }

    const options = Array.from(labelLookup.entries()).map<FieldOption>(
      ([key, label]) => ({
        key,
        label
      })
    );

    options.sort((a, b) => {
      const orderA = orderMap.get(a.key) ?? Number.MAX_SAFE_INTEGER;
      const orderB = orderMap.get(b.key) ?? Number.MAX_SAFE_INTEGER;
      if (orderA === orderB) {
        return a.label.localeCompare(b.label);
      }
      return orderA - orderB;
    });

    return options;
  }, [extractionResults, schemaPropertiesByJob]);

  const defaultSelectedKeys = useMemo(() => {
    const defaults = new Set<string>();
    DEFAULT_EMAIL_FIELDS.forEach((field) => {
      if (dataFieldOptions.some((option) => option.key === field)) {
        defaults.add(field);
      }
    });
    return Array.from(defaults);
  }, [dataFieldOptions]);

  const metaFieldOptions = useMemo<FieldOption[]>(
    () =>
      META_FIELD_DEFINITIONS.map(({ key, label }) => ({
        key,
        label
      })),
    []
  );

  const handleCopyEmail = () => {
    setIsDialogOpen(true);
  };

  const handleConfirmFields = async (selectedKeys: string[]) => {
    setIsCopying(true);
    try {
      const metaKeys = new Set(
        META_FIELD_DEFINITIONS.map((definition) => definition.key)
      );

      const selectedMetaFields = selectedKeys.filter((key) =>
        metaKeys.has(key)
      );
      const selectedDataFields = selectedKeys.filter(
        (key) => !metaKeys.has(key)
      );

      const emailText = await generateEmail.mutateAsync({
        projectId,
        supplierId: supplier.id,
        dataFields: selectedDataFields,
        metaFields: selectedMetaFields
      });

      await navigator.clipboard.writeText(emailText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setIsDialogOpen(false);
    } catch {
      // Copy failed silently
    } finally {
      setIsCopying(false);
    }
  };

  // Parse materials offered from JSON
  const materialsOffered = Array.isArray(supplier.materialsOffered)
    ? supplier.materialsOffered
    : [];

  // Parse address from JSON
  const rawAddress =
    supplier.address && typeof supplier.address === "object"
      ? (supplier.address as Record<string, unknown>)
      : null;
  const country =
    rawAddress && typeof rawAddress["country"] === "string"
      ? (rawAddress["country"] as string)
      : "Unknown";

  // Extract meta information
  const supplierMeta =
    supplier.meta && typeof supplier.meta === "object"
      ? (supplier.meta as Record<string, unknown>)
      : null;
  const deliverySpeed =
    supplierMeta && typeof supplierMeta["deliverySpeed"] === "string"
      ? (supplierMeta["deliverySpeed"] as string)
      : "N/A";
  const totalTrades =
    supplierMeta && typeof supplierMeta["totalTrades"] === "number"
      ? (supplierMeta["totalTrades"] as number)
      : 0;

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      {/* Supplier Header */}
      <div className="p-6">
        <div className="flex flex-col gap-6 lg:gap-4">
          {/* Left: Supplier Info */}
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-card shrink-0">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-bold mb-2 break-words">
                {supplier.name}
              </h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {materialsOffered.slice(0, 5).map((tag, index) => (
                  <Badge key={index} variant="secondary" className="text-xs">
                    {String(tag)}
                  </Badge>
                ))}
                {materialsOffered.length > 5 && (
                  <Badge variant="secondary" className="text-xs">
                    +{materialsOffered.length - 5} more
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                {deliverySpeed !== "N/A" && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span className="truncate">Delivery: {deliverySpeed}</span>
                  </div>
                )}
                {totalTrades > 0 && (
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {totalTrades.toLocaleString()} trades
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <Globe className="h-4 w-4 shrink-0" />
                  <span className="truncate">{country}</span>
                </div>
                {supplier.contactEmail && (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Mail className="h-4 w-4 shrink-0" />
                    <span className="truncate">{supplier.contactEmail}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Match Stats and Actions */}
          <div className="flex flex-col gap-4 lg:items-end lg:flex-row lg:justify-between">
            <div className="w-full lg:w-auto lg:max-w-xs">
              <div className="flex items-center justify-between mb-2 gap-4">
                <div className="flex items-center gap-2 shrink-0">
                  <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                    Can source
                  </span>
                </div>
                <div className="flex items-baseline gap-1 shrink-0">
                  <span className="text-2xl font-bold text-green-600">
                    {matchedItems}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    / {totalProjectItems}
                  </span>
                </div>
              </div>
              <Progress value={matchPercentage} className="h-2 mb-2" />
              <p className="text-xs text-muted-foreground lg:text-right">
                {matchPercentage}% match rate across all extraction jobs
              </p>
            </div>
            <Button
              className="w-full lg:w-auto bg-green-600 hover:bg-green-700 shrink-0"
              onClick={handleCopyEmail}
              disabled={generateEmail.isPending || isCopying}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Copied to clipboard
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy email to clipboard
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
      <FieldSelectionDialog
        isOpen={isDialogOpen}
        onClose={() => {
          if (!isCopying && !generateEmail.isPending) {
            setIsDialogOpen(false);
          }
        }}
        title="Choose Additional Fields"
        description="Select which data points to append for each matched extraction before copying the email."
        dataFields={dataFieldOptions}
        metaFields={metaFieldOptions}
        defaultSelectedKeys={defaultSelectedKeys}
        allowEmptySelection
        confirmLabel="Copy Email"
        isConfirming={generateEmail.isPending || isCopying}
        onConfirm={handleConfirmFields}
      />
    </Card>
  );
}
