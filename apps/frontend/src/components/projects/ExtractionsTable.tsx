import { useMemo } from "react";
import { useExtractionJobs } from "@packages/core-client";
import type { DataLayer, ExtractionJob } from "@packages/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@packages/ui";
import { Play } from "lucide-react";
import { EmptyState, TableSkeleton } from "@/components/common";
import { ExtractionJobRow } from "./ExtractionJobRow";

interface ExtractionsTableProps {
  dataLayers: DataLayer[];
  loading?: boolean;
  expandedJobs: Set<string>;
  onToggleJobExpansion: (jobId: string) => void;
  onViewResults: (job: ExtractionJob) => void;
  onViewFile?: (dataLayer: DataLayer) => void;
  onDownloadFile: (dataLayer: DataLayer) => void;
  onSwitchToAttachments: () => void;
  onViewLogs: (job: ExtractionJob) => void;
}

export function ExtractionsTable({
  dataLayers,
  loading,
  expandedJobs,
  onToggleJobExpansion,
  onViewResults,
  onViewFile,
  onDownloadFile,
  onSwitchToAttachments,
  onViewLogs
}: ExtractionsTableProps) {
  // Read directly from Redux store - updates automatically via WebSocket
  const allExtractionJobs = useExtractionJobs();

  // Filter jobs for this project
  const extractionJobs = useMemo(() => {
    const dataLayerIds = new Set(dataLayers.map((dl) => dl.id));

    return allExtractionJobs
      .filter((job: ExtractionJob) => {
        const jobDataLayers = (
          job as ExtractionJob & {
            extractionJobDataLayers?: Array<{ dataLayerId: string }>;
          }
        ).extractionJobDataLayers;

        if (!jobDataLayers || !Array.isArray(jobDataLayers)) {
          return false;
        }

        // Check if ANY of the job's data layers belong to this project
        return jobDataLayers.some((jdl) => dataLayerIds.has(jdl.dataLayerId));
      })
      .sort(
        (a: ExtractionJob, b: ExtractionJob) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }, [allExtractionJobs, dataLayers]);
  const emptyState = (
    <EmptyState
      icon={Play}
      title="No extraction jobs yet"
      description="Upload files and start extraction from the Attachments tab"
      action={{
        label: "View Attachments",
        onClick: onSwitchToAttachments
      }}
    />
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">
              Extraction Jobs ({extractionJobs.length})
            </CardTitle>
            <CardDescription>
              AI-powered extraction from uploaded documents
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <TableSkeleton rows={3} columns={5} />
        ) : extractionJobs.length === 0 ? (
          emptyState
        ) : (
          <div className="space-y-4">
            {/* Table Header */}
            <div className="hidden md:grid grid-cols-12 gap-4 pb-3 border-b text-sm font-medium text-muted-foreground">
              <div className="col-span-4">Job</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1">State</div>
              <div className="col-span-2">Completed</div>
              <div className="col-span-3">Actions</div>
            </div>

            {/* Job Rows */}
            {extractionJobs.map((job) => (
              <div
                key={job.id}
                className="border-b last:border-b-0 border-gray-100"
              >
                <ExtractionJobRow
                  key={job.id}
                  job={job}
                  dataLayers={dataLayers}
                  isExpanded={expandedJobs.has(job.id)}
                  onToggleExpansion={onToggleJobExpansion}
                  onViewResults={onViewResults}
                  onViewFile={onViewFile}
                  onDownloadFile={onDownloadFile}
                  onViewLogs={onViewLogs}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
