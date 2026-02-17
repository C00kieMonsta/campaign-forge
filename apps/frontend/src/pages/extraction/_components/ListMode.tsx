import { useCallback, useState, type FC } from "react";
import { VERIFICATION_STATUSES } from "@packages/types";
import type { ExtractionResultStatus, SchemaProperty } from "@packages/types";
import {
  ExtractionRow,
  type FlexibleExtractionResult
} from "@/components/extraction";
import { BulkActionBar, DeleteConfirmDialog, MergeDialog } from "./index";

interface ListModeProps {
  filteredResults: FlexibleExtractionResult[];
  schemaProperties: SchemaProperty[];
  selectedIds: Set<string>;
  editingCell: { id: string; field: string } | null;
  editValue: string;
  isDeletingResults: boolean;
  isMergingResults: boolean;
  updatingSupplierForRow: string | null;
  loading: boolean;
  results: { id?: string; rawExtraction?: Record<string, unknown> }[];
  onStartEdit: (id: string, field: string, value: string) => void;
  onSaveEdit: () => Promise<void>;
  onCancelEdit: () => void;
  onSelect: (id: string, selected: boolean) => void;
  onStatusChange: (
    id: string,
    status: "accepted" | "pending"
  ) => Promise<void>;
  onEditValueChange: (value: string) => void;
  onDelete: (id: string) => Promise<void>;
  onSelectSupplier: (resultId: string, supplierId: string) => Promise<void>;
  onClearSelection: () => void;
  onConfirmDelete: () => Promise<void>;
  onConfirmMerge: (
    primaryId: string,
    secondaryIds: string[],
    mergedData: Record<string, unknown>
  ) => Promise<void>;
}

export const ListMode: FC<ListModeProps> = ({
  filteredResults,
  schemaProperties,
  selectedIds,
  editingCell,
  editValue,
  isDeletingResults,
  isMergingResults,
  updatingSupplierForRow,
  loading,
  results,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onSelect,
  onStatusChange,
  onEditValueChange,
  onDelete,
  onSelectSupplier,
  onClearSelection,
  onConfirmDelete,
  onConfirmMerge
}) => {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const selectedItems = filteredResults.filter((item) =>
    selectedIds.has(item.id)
  );
  const canMerge = selectedIds.size >= 2;

  const handleDeleteSelected = useCallback(() => {
    setShowDeleteDialog(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    await onConfirmDelete();
    setShowDeleteDialog(false);
  }, [onConfirmDelete]);

  const handleMergeSelected = useCallback(() => {
    setShowMergeDialog(true);
  }, []);

  const handleConfirmMerge = useCallback(
    async (
      primaryId: string,
      secondaryIds: string[],
      mergedData: Record<string, unknown>
    ) => {
      await onConfirmMerge(primaryId, secondaryIds, mergedData);
      setShowMergeDialog(false);
    },
    [onConfirmMerge]
  );

  return (
    <>
      {/* Loading Overlay */}
      {(isDeletingResults || isMergingResults) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 flex items-center space-x-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {isDeletingResults ? "Deleting items..." : "Merging items..."}
              </span>
              <span className="text-xs text-muted-foreground mt-1">
                Refreshing data to ensure accuracy...
              </span>
            </div>
          </div>
        </div>
      )}

      <main className="container mx-auto px-4 py-2 sm:px-6">
        <div className="space-y-0 max-w-full overflow-hidden p-2 sm:p-4">
          {filteredResults.map((material) => {
            const rawResult = results.find((r) => r?.id === material.id);
            return (
              <ExtractionRow
                key={material.id}
                material={material}
                schema={schemaProperties}
                editingCell={editingCell}
                editValue={editValue}
                onStartEdit={onStartEdit}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
                onUpdateStatus={(status: ExtractionResultStatus) =>
                  onStatusChange(
                    material.id!,
                    status === VERIFICATION_STATUSES.ACCEPTED
                      ? VERIFICATION_STATUSES.ACCEPTED
                      : VERIFICATION_STATUSES.PENDING
                  )
                }
                onEditValueChange={onEditValueChange}
                rawData={
                  rawResult?.rawExtraction as
                    | Record<string, unknown>
                    | undefined
                }
                isSelected={selectedIds.has(material.id)}
                onSelect={onSelect}
                onDelete={onDelete}
                onSelectSupplier={onSelectSupplier}
                isSelectingSupplier={updatingSupplierForRow === material.id}
              />
            );
          })}
        </div>
      </main>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 &&
        !isDeletingResults &&
        !isMergingResults &&
        !loading && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            canMerge={canMerge}
            onDelete={handleDeleteSelected}
            onMerge={handleMergeSelected}
            onClearSelection={onClearSelection}
          />
        )}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        itemCount={selectedIds.size}
        onConfirm={handleConfirmDelete}
      />

      {/* Merge Dialog */}
      <MergeDialog
        open={showMergeDialog}
        onOpenChange={setShowMergeDialog}
        items={selectedItems}
        onConfirm={handleConfirmMerge}
      />
    </>
  );
};
