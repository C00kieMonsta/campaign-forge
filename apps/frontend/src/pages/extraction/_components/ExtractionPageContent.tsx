import { type FC } from "react";
import type { SchemaProperty } from "@packages/types";
import { Button, Card, CardContent, CardHeader, Skeleton } from "@packages/ui";
import { AlertCircle, FileText } from "lucide-react";
import type { FlexibleExtractionResult } from "@/components/extraction";
import { ListMode } from "./ListMode";
import { VerificationMode } from "./VerificationMode";

interface ExtractionResult {
  id: string;
  rawExtraction?: Record<string, unknown> | unknown;
  [key: string]: unknown;
}

interface ExtractionPageContentProps {
  viewMode: "list" | "verification";
  loading: boolean;
  error: string | null;
  results: ExtractionResult[];
  filteredResults: FlexibleExtractionResult[];
  schemaProperties: SchemaProperty[];
  selectedIds: Set<string>;
  editingCell: { id: string; field: string } | null;
  editValue: string;
  isDeletingResults: boolean;
  isMergingResults: boolean;
  updatingSupplierForRow: string | null;
  sortBy: string | null;
  sortDirection: "asc" | "desc";
  filterProperty: string | null;
  filterValue: string;
  onStartEdit: (id: string, field: string, value: string) => void;
  onSaveEdit: () => Promise<void>;
  onCancelEdit: () => void;
  onSelect: (id: string, selected: boolean) => void;
  onStatusChange: (id: string, status: "accepted" | "pending") => Promise<void>;
  onEditValueChange: (value: string) => void;
  onDelete: (id: string) => Promise<void>;
  onSelectSupplier: (resultId: string, supplierId: string) => Promise<void>;
  onRefetch: () => Promise<void>;
  onClearSelection: () => void;
  onConfirmDelete: () => Promise<void>;
  onConfirmMerge: (
    primaryId: string,
    secondaryIds: string[],
    mergedData: Record<string, unknown>
  ) => Promise<void>;
  onSortChange: (property: string | null, direction: "asc" | "desc") => void;
  onFilterChange: (property: string | null, value: string) => void;
}

export const ExtractionPageContent: FC<ExtractionPageContentProps> = ({
  viewMode,
  loading,
  error,
  results,
  filteredResults,
  schemaProperties,
  selectedIds,
  editingCell,
  editValue,
  isDeletingResults,
  isMergingResults,
  updatingSupplierForRow,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onSelect,
  onStatusChange,
  onEditValueChange,
  onDelete,
  onSelectSupplier,
  onRefetch,
  onClearSelection,
  onConfirmDelete,
  onConfirmMerge
}) => {
  if (loading) {
    return (
      <main className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex w-full gap-6">
          <div className="w-2/5 flex flex-col">
            <Card className="mb-4">
              <CardHeader className="pb-3">
                <Skeleton className="h-5 w-48" />
              </CardHeader>
              <CardContent className="p-0">
                <div className="space-y-2 p-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="p-3 rounded-lg border">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <Skeleton className="h-4 w-3/4 mb-2" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <Skeleton className="h-5 w-12" />
                          <Skeleton className="h-4 w-8" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="w-3/5">
            <Card className="h-full">
              <CardHeader className="pb-4">
                <Skeleton className="h-4 w-52" />
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <Skeleton className="h-10 w-full" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-600 font-medium">Failed to load results</p>
            <p className="text-sm text-gray-500 mt-1">{error}</p>
            <Button
              onClick={onRefetch}
              variant="outline"
              size="sm"
              className="mt-4"
            >
              Retry
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (results.length === 0) {
    return (
      <main className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">No materials extracted</p>
            <p className="text-sm text-gray-500 mt-1">
              This extraction job did not find any materials.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (filteredResults.length === 0) {
    return (
      <main className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">
              No results match the current filter
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Try changing the filter to see more results.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const resultsWithRawExtraction = results as {
    id?: string;
    rawExtraction?: Record<string, unknown>;
  }[];

  if (viewMode === "verification") {
    return (
      <VerificationMode
        extractions={filteredResults}
        schemaProperties={schemaProperties}
        editingCell={editingCell}
        editValue={editValue}
        updatingSupplierForRow={updatingSupplierForRow}
        results={resultsWithRawExtraction}
        onStartEdit={onStartEdit}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
        onEditValueChange={onEditValueChange}
        onStatusChange={onStatusChange}
        onDelete={onDelete}
        onSelectSupplier={onSelectSupplier}
      />
    );
  }

  return (
    <ListMode
      filteredResults={filteredResults}
      schemaProperties={schemaProperties}
      selectedIds={selectedIds}
      editingCell={editingCell}
      editValue={editValue}
      isDeletingResults={isDeletingResults}
      isMergingResults={isMergingResults}
      updatingSupplierForRow={updatingSupplierForRow}
      loading={loading}
      results={resultsWithRawExtraction}
      onStartEdit={onStartEdit}
      onSaveEdit={onSaveEdit}
      onCancelEdit={onCancelEdit}
      onSelect={onSelect}
      onStatusChange={onStatusChange}
      onEditValueChange={onEditValueChange}
      onDelete={onDelete}
      onSelectSupplier={onSelectSupplier}
      onClearSelection={onClearSelection}
      onConfirmDelete={onConfirmDelete}
      onConfirmMerge={onConfirmMerge}
    />
  );
};
