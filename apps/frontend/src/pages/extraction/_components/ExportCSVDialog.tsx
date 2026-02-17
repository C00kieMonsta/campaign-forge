import { useMemo } from "react";
import type { SchemaProperty } from "@packages/types";
import { Button } from "@packages/ui";
import { Download } from "lucide-react";
import {
  FieldSelectionDialog,
  type FieldOption
} from "@/components/common/FieldSelectionDialog";
import type { FlexibleExtractionResult } from "@/components/extraction/ExtractionRow";

interface ExportCSVDialogProps {
  isOpen: boolean;
  onClose: () => void;
  results: FlexibleExtractionResult[];
  jobName: string;
  schemaProperties?: SchemaProperty[];
}

export function ExportCSVDialog({
  isOpen,
  onClose,
  results,
  jobName,
  schemaProperties
}: ExportCSVDialogProps) {
  const availableFields = useMemo(() => {
    const metaFields: string[] = [
      "Status",
      "Confidence Score",
      "Location in Document",
      "Page Number",
      "Original Snippet"
    ];

    const orderedDataFields = schemaProperties
      ? schemaProperties.map((prop) => prop.name)
      : [];

    return {
      dataFields: orderedDataFields,
      metaFields
    };
  }, [schemaProperties]);

  const defaultDataFieldKeys = useMemo(() => {
    const defaults = [
      "itemCode",
      "itemName",
      "technicalSpecifications",
      "quantity",
      "unit",
      "executionNotes"
    ];

    return defaults.filter((field) =>
      availableFields.dataFields.includes(field)
    );
  }, [availableFields.dataFields]);

  const dataFieldOptions = useMemo<FieldOption[]>(
    () =>
      availableFields.dataFields.map((field) => ({
        key: field,
        label: field
      })),
    [availableFields.dataFields]
  );

  const metaFieldOptions = useMemo<FieldOption[]>(
    () =>
      availableFields.metaFields.map((field) => ({
        key: field,
        label: field
      })),
    [availableFields.metaFields]
  );

  const handleExport = (selectedKeys: string[]) => {
    if (results.length === 0 || selectedKeys.length === 0) {
      return;
    }

    const selectedDataFields = availableFields.dataFields.filter((field) =>
      selectedKeys.includes(field)
    );
    const selectedMetaFields = availableFields.metaFields.filter((field) =>
      selectedKeys.includes(field)
    );

    const headers = [...selectedDataFields, ...selectedMetaFields];

    const csvRows = results.map((result) => {
      const rawData = (result.rawExtraction as Record<string, unknown>) || {};
      const verifiedData =
        (result.verifiedData as Record<string, unknown>) || {};
      const effectiveData = { ...rawData, ...verifiedData };

      const row: (string | number)[] = [];

      selectedDataFields.forEach((field) => {
        const value = effectiveData[field];
        row.push(value !== undefined && value !== null ? String(value) : "");
      });

      selectedMetaFields.forEach((field) => {
        switch (field) {
          case "Status":
            row.push(result.status || "pending");
            break;
          case "Confidence Score":
            row.push(result.confidenceScore || "");
            break;
          case "Location in Document":
            row.push(result.locationInDoc || "");
            break;
          case "Page Number":
            row.push(result.pageNumber || "");
            break;
          case "Original Snippet":
            row.push(result.originalSnippet || "");
            break;
          default:
            row.push("");
        }
      });

      return row;
    });

    const csvContent = [headers, ...csvRows]
      .map((row) =>
        row.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `extraction-results-${jobName}-${new Date().toISOString().split("T")[0]}.csv`
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    onClose();
  };

  return (
    <FieldSelectionDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Export to CSV"
      description="Select the fields you want to include in the export. By default, visible fields are selected."
      dataFields={dataFieldOptions}
      metaFields={metaFieldOptions}
      defaultSelectedKeys={[...defaultDataFieldKeys, "Page Number"]}
      onConfirm={handleExport}
      renderConfirmButton={({ onConfirm, disabled }) => (
        <Button
          onClick={onConfirm}
          disabled={disabled || results.length === 0}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      )}
    />
  );
}
