import type { DataLayer } from "@packages/types";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@packages/ui";
import { FileText, Upload } from "lucide-react";
import { EmptyState, TableSkeleton } from "@/components/common";
import { FileRow } from "./FileRow";

type OrganizedFile = DataLayer & {
  level: number;
  isParent: boolean;
  isExpanded?: boolean;
  parentId?: string | null;
};

interface AttachmentsTableProps {
  dataLayers: DataLayer[];
  loading?: boolean;
  deletingFiles: Set<string>;
  deletedFiles: Set<string>;
  expandedZips: Set<string>;
  onToggleZipExpansion: (zipId: string) => void;
  onUpload: () => void;
  onView?: (dataLayer: DataLayer) => void;
  onDownload: (dataLayer: DataLayer) => void;
  onDelete: (dataLayer: DataLayer) => void;
}

export function AttachmentsTable({
  dataLayers,
  loading,
  deletingFiles,
  deletedFiles,
  expandedZips,
  onToggleZipExpansion,
  onUpload,
  onView,
  onDownload,
  onDelete
}: AttachmentsTableProps) {
  // Helper function to organize files hierarchically
  const organizeFiles = (dataLayers: DataLayer[]): OrganizedFile[] => {
    const organized = [];
    const processedChildren = new Set();

    // Filter out deleted files for optimistic UI updates
    const filteredDataLayers = dataLayers.filter(
      (file) => !deletedFiles.has(file.id)
    );

    for (const file of filteredDataLayers) {
      // Skip if this file is already processed as a child
      if (processedChildren.has(file.id)) continue;

      if (file.fileType === "zip") {
        // Add zip file
        const zipFile = {
          ...file,
          level: 0,
          isParent: true,
          isExpanded: expandedZips.has(file.id)
        };
        organized.push(zipFile);

        // Add children if expanded
        if (expandedZips.has(file.id) && file.children) {
          file.children.forEach((child) => {
            organized.push({
              ...child,
              level: 1,
              isParent: false,
              parentId: file.id
            });
            processedChildren.add(child.id);
          });
        }
      } else if (file.sourceType !== "zip_extraction") {
        // Add regular files (not extracted from zip)
        organized.push({ ...file, level: 0, isParent: false });
      }
    }

    return organized;
  };

  const emptyState = (
    <EmptyState
      icon={FileText}
      title="No files uploaded yet"
      description="Upload PDF, DOCX, or image files to get started"
      action={{
        label: "Upload Files",
        onClick: onUpload
      }}
    />
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">
              Attachments ({dataLayers.length})
            </CardTitle>
            <CardDescription>Files uploaded to this project</CardDescription>
          </div>
          <Button className="gap-2" onClick={onUpload}>
            <Upload className="h-4 w-4" />
            Upload Files
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <TableSkeleton rows={3} columns={4} />
        ) : dataLayers.length === 0 ? (
          emptyState
        ) : (
          <div className="space-y-4">
            {/* Table Header */}
            <div className="hidden md:grid grid-cols-12 gap-4 pb-3 border-b text-sm font-medium text-muted-foreground">
              <div className="col-span-5">Name</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Uploaded</div>
              <div className="col-span-2">Actions</div>
            </div>

            {/* File Rows */}
            {organizeFiles(dataLayers).map((dataLayer) => (
              <div
                key={dataLayer.id}
                className="border-b last:border-b-0 border-gray-100"
              >
                <FileRow
                  key={dataLayer.id}
                  dataLayer={dataLayer}
                  onToggleExpansion={onToggleZipExpansion}
                  {...(onView && { onView })}
                  onDownload={onDownload}
                  onDelete={onDelete}
                  isDeleting={deletingFiles.has(dataLayer.id)}
                  isDeleted={deletedFiles.has(dataLayer.id)}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
