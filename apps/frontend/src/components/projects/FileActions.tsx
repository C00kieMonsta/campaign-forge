
import { Button } from "@packages/ui";
import type { DataLayer } from "@packages/types";
import { Download, Eye, Trash2 } from "lucide-react";

interface FileActionsProps {
  dataLayer: DataLayer;
  onView?: (dataLayer: DataLayer) => void;
  onDownload: (dataLayer: DataLayer) => void;
  onDelete: (dataLayer: DataLayer) => void;
  isDeleting?: boolean;
}

export function FileActions({
  dataLayer,
  onView,
  onDownload,
  onDelete,
  isDeleting = false
}: FileActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {dataLayer.fileType === "pdf" && onView && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onView(dataLayer)}
          disabled={isDeleting}
          title="View file"
        >
          <Eye className="h-4 w-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDownload(dataLayer)}
        disabled={isDeleting}
        title="Download file"
      >
        <Download className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDelete(dataLayer)}
        disabled={isDeleting}
        className="text-destructive hover:text-destructive disabled:opacity-50"
        title="Delete file"
      >
        {isDeleting ? (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-destructive border-t-transparent" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
