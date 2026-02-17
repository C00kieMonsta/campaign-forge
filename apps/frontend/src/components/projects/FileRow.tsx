import type { DataLayer } from "@packages/types";
import { Badge, Button, cn } from "@packages/ui";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { StatusBadge } from "@/components/common";
import { formatDateSafe } from "@/utils/date-utils";
import { FileActions } from "./FileActions";

interface OrganizedFile extends DataLayer {
  level: number;
  isParent: boolean;
  isExpanded?: boolean;
}

interface FileRowProps {
  dataLayer: OrganizedFile;
  onToggleExpansion?: (id: string) => void;
  onView?: (dataLayer: DataLayer) => void;
  onDownload: (dataLayer: DataLayer) => void;
  onDelete: (dataLayer: DataLayer) => void;
  isDeleting?: boolean;
  isDeleted?: boolean;
}

export function FileRow({
  dataLayer,
  onToggleExpansion,
  onView,
  onDownload,
  onDelete,
  isDeleting = false,
  isDeleted = false
}: FileRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-12 gap-4 py-3 hover:bg-muted/30 rounded-lg transition-all duration-300 md:grid-cols-12",
        dataLayer.level > 0 && "bg-muted/20",
        isDeleting && "opacity-50 bg-destructive/5",
        isDeleted && "opacity-30 scale-95"
      )}
    >
      {/* Name Column */}
      <div className="col-span-12 md:col-span-5 flex items-center gap-3">
        {dataLayer.level > 0 && (
          <div className="w-4 h-4 flex items-center justify-center ml-4">
            <div className="w-2 h-2 border-l-2 border-b-2 border-muted-foreground/30"></div>
          </div>
        )}
        {dataLayer.isParent && onToggleExpansion && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => onToggleExpansion(dataLayer.id)}
          >
            {dataLayer.isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        )}
        <FileText className="h-5 w-5 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground truncate block">
            {dataLayer.name}
          </span>
          {dataLayer.sourceType === "zip_extraction" && (
            <Badge
              variant="outline"
              className="text-xs bg-secondary/10 text-secondary-foreground border-secondary/20 mt-1"
            >
              From ZIP
            </Badge>
          )}
          {dataLayer.children && dataLayer.children.length > 0 && (
            <span className="text-xs text-muted-foreground block">
              ({dataLayer.children.length} files)
            </span>
          )}
        </div>
      </div>

      {/* Status Column */}
      <div className="col-span-6 md:col-span-2 mt-2 md:mt-0">
        <StatusBadge status={dataLayer.processingStatus} />
      </div>

      {/* Uploaded Column */}
      <div className="col-span-6 md:col-span-2 text-sm text-muted-foreground mt-2 md:mt-0">
        {formatDateSafe(dataLayer.createdAt)}
      </div>

      {/* Actions Column */}
      <div className="col-span-12 md:col-span-2 flex items-center gap-2 mt-3 md:mt-0">
        <FileActions
          dataLayer={dataLayer}
          {...(onView && { onView })}
          onDownload={onDownload}
          onDelete={onDelete}
          isDeleting={isDeleting}
        />
      </div>
    </div>
  );
}
