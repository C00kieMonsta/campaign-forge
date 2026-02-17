import {
  ASYNC_JOB_STATUSES,
  formatPageProgress,
  hasPageProgress,
  parseExtractionJobMetadata,
  type DataLayer,
  type ExtractionJob
} from "@packages/types";
import { Badge, Button } from "@packages/ui";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Loader2,
  Play,
  ScrollText,
  XCircle
} from "lucide-react";
import { StatusBadge } from "@/components/common";
import { formatDateSafe } from "@/utils/date-utils";

interface ExtractionJobRowProps {
  job: ExtractionJob;
  dataLayers: DataLayer[];
  isExpanded: boolean;
  onToggleExpansion: (jobId: string) => void;
  onViewResults: (job: ExtractionJob) => void;
  onViewFile?: ((dataLayer: DataLayer) => void) | undefined;
  onDownloadFile: (dataLayer: DataLayer) => void;
  onViewLogs: (job: ExtractionJob) => void;
}

export function ExtractionJobRow({
  job,
  dataLayers,
  isExpanded,
  onToggleExpansion,
  onViewResults,
  onViewFile,
  onDownloadFile,
  onViewLogs
}: ExtractionJobRowProps) {
  const associatedFiles =
    job.extractionJobDataLayers
      ?.map((jdl) => dataLayers.find((dl) => dl.id === jdl.dataLayerId))
      .filter(Boolean) || [];

  // Extract page progress from job metadata
  const pageProgress = parseExtractionJobMetadata(job.meta);

  return (
    <div className="space-y-0">
      {/* Main Job Row */}
      <div className="grid grid-cols-12 gap-4 py-3 hover:bg-muted/30 rounded-lg transition-colors">
        {/* Job Column */}
        <div className="col-span-12 md:col-span-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => onToggleExpansion(job.id)}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
          <Play className="h-5 w-5 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">
                Job #{job.id.slice(-4)}
              </span>
              {job.schema && (
                <Badge variant="secondary" className="text-xs">
                  {job.schema.name} v{job.schema.version}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground">
                {formatDateSafe(job.createdAt)}
              </span>
              {hasPageProgress(pageProgress) &&
                job.status !== ASYNC_JOB_STATUSES.COMPLETED && (
                  <span className="text-xs font-medium text-primary">
                    • {formatPageProgress(pageProgress)} processed
                  </span>
                )}
            </div>
          </div>
        </div>

        {/* Status Column */}
        <div className="col-span-6 md:col-span-2 flex items-center">
          <StatusBadge status={job.status} />
        </div>

        {/* Status Indicator Column */}
        <div className="col-span-6 md:col-span-1 flex items-center justify-center">
          {job.status === "running" || job.status === "queued" ? (
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          ) : job.status === ASYNC_JOB_STATUSES.COMPLETED ? (
            <CheckCircle className="h-5 w-5 text-green-600" />
          ) : job.status === ASYNC_JOB_STATUSES.FAILED ? (
            <XCircle className="h-5 w-5 text-red-600" />
          ) : (
            <div className="h-5 w-5 rounded-full bg-gray-300" />
          )}
        </div>

        {/* Completed Column */}
        <div className="col-span-12 md:col-span-2 flex items-center text-sm text-muted-foreground">
          {formatDateSafe(job.completedAt)}
        </div>

        {/* Actions Column */}
        <div className="col-span-12 md:col-span-3 flex items-center">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onViewLogs(job)}
              className="gap-1.5 bg-transparent"
            >
              <ScrollText className="h-3 w-3" />
              Logs
            </Button>
            {job.status === ASYNC_JOB_STATUSES.COMPLETED && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onViewResults(job)}
                className="gap-1.5 bg-transparent"
              >
                <Eye className="h-3 w-3" />
                Results
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded File Details */}
      {isExpanded && associatedFiles.length > 0 && (
        <div className="bg-muted/20 border-l-2 border-gray-100 ml-8 pl-4 py-3">
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground mb-2">
              Associated Files ({associatedFiles.length})
            </div>
            {associatedFiles.map(
              (associatedFile: DataLayer | undefined, fileIndex: number) => (
                <div
                  key={associatedFile?.id || fileIndex}
                  className="grid grid-cols-12 gap-4"
                >
                  <div className="col-span-12 md:col-span-6 flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground truncate block">
                        {associatedFile?.name || "Unknown File"}
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {associatedFile?.fileType?.toUpperCase() || "UNKNOWN"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Uploaded: {formatDateSafe(associatedFile?.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="col-span-12 md:col-span-6 flex items-center justify-end gap-2">
                    {associatedFile?.fileType === "pdf" && onViewFile && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onViewFile(associatedFile)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        View File
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDownloadFile(associatedFile!)}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
