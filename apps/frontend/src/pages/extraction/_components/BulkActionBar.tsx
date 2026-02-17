import { Button } from "@packages/ui";
import { Merge, Trash2, X } from "lucide-react";

interface BulkActionBarProps {
  selectedCount: number;
  canMerge: boolean;
  onDelete: () => void;
  onMerge: () => void;
  onClearSelection: () => void;
}

export function BulkActionBar({
  selectedCount,
  canMerge,
  onDelete,
  onMerge,
  onClearSelection
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
      <div className="bg-card border shadow-lg rounded-lg px-6 py-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">
            {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
          </span>

          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>

            <Button
              variant="default"
              size="sm"
              onClick={onMerge}
              disabled={!canMerge}
              className="gap-2"
            >
              <Merge className="h-4 w-4" />
              Merge
            </Button>

            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
