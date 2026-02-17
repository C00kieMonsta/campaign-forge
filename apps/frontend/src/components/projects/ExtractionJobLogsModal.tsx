import { useEffect, useState } from "react";
import type { ExtractionJob } from "@packages/types";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ScrollArea
} from "@packages/ui";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2,
  ScrollText
} from "lucide-react";
import { apiGet } from "@/lib/api";

interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

interface ExtractionJobLogsModalProps {
  job: ExtractionJob | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ExtractionJobLogsModal({
  job,
  isOpen,
  onClose
}: ExtractionJobLogsModalProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && job) {
      fetchLogs();
    }
  }, [isOpen, job]);

  const fetchLogs = async () => {
    if (!job) return;

    try {
      setLoading(true);
      setError(null);

      const response = await apiGet(`/extraction/job/${job.id}/logs`);
      if (response.ok) {
        const data = await response.json();
        // Reverse the logs to show most recent first
        setLogs((data.logs || []).reverse());
      } else {
        throw new Error("Failed to fetch logs");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const getLevelIcon = (level: string) => {
    switch (level) {
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "warn":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getLevelBadgeVariant = (level: string) => {
    switch (level) {
      case "error":
        return "destructive";
      case "warn":
        return "secondary";
      default:
        return "outline";
    }
  };

  const isJobRunning =
    job && (job.status === "running" || job.status === "queued");

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScrollText className="h-5 w-5" />
              <DialogTitle>
                Extraction Job Logs #{job?.id.slice(-8)}
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="text-sm text-muted-foreground">
                Loading logs...
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-48">
              <div className="text-sm text-red-500">{error}</div>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <div className="text-sm text-muted-foreground">
                No logs available
              </div>
            </div>
          ) : (
            <ScrollArea className="h-[400px] border rounded-md">
              <div className="space-y-3 p-4">
                {/* Show loader at top when job is still running */}
                {isJobRunning && (
                  <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                    <span className="text-xs text-blue-600 font-medium">
                      Job is running - more logs may appear
                    </span>
                  </div>
                )}
                {logs.map((log, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg border"
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {getLevelIcon(log.level)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={getLevelBadgeVariant(log.level)}>
                          {log.level.toUpperCase()}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatTimestamp(log.timestamp)}
                        </span>
                      </div>
                      <p className="text-sm break-words">{log.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {logs.length} log {logs.length === 1 ? "entry" : "entries"}
          </div>
          <Button onClick={fetchLogs} variant="outline" size="sm">
            Refresh
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
