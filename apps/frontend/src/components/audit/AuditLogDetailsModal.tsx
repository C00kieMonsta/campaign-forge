
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ScrollArea,
  useToast
} from "@packages/ui";
import { Copy, Database } from "lucide-react";
import { FullHeightDialog } from "@/components/common";
import type { AuditLog } from "@/hooks/use-audit-logs";

interface AuditLogDetailsModalProps {
  log: AuditLog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuditLogDetailsModal({
  log,
  open,
  onOpenChange
}: AuditLogDetailsModalProps) {
  const { toast } = useToast();

  if (!log) return null;

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied to clipboard",
        description: `${label} has been copied to your clipboard.`
      });
    } catch {
      toast({
        title: "Failed to copy",
        description: "Unable to copy to clipboard. Please try again.",
        variant: "destructive"
      });
    }
  };

  const formatJson = (data: unknown) => {
    if (!data) return null;
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  const formattedBefore = formatJson(log.before);
  const formattedAfter = formatJson(log.after);
  const hasBefore = formattedBefore !== null;
  const hasAfter = formattedAfter !== null;
  const hasDataChanges = hasBefore || hasAfter;

  return (
    <FullHeightDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Data Changes - ${log.action} on ${log.targetTable}`}
    >
      {!hasDataChanges ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center text-muted-foreground">
              <Database className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg">
                No data changes recorded for this action.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
          {/* Before */}
          <Card className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Before</span>
                {hasBefore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(formattedBefore ?? "", "Before data")
                    }
                    className="gap-1"
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0">
              <ScrollArea className="h-[600px] px-6 pb-6">
                {hasBefore ? (
                  <pre className="text-sm bg-muted p-4 rounded-md overflow-x-auto font-mono">
                    {formattedBefore}
                  </pre>
                ) : (
                  <div className="text-center text-muted-foreground py-16">
                    <span className="text-lg">No before state available</span>
                    <p className="text-sm mt-2">
                      This is likely a CREATE operation
                    </p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* After */}
          <Card className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center justify-between">
                <span>After</span>
                {hasAfter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(formattedAfter ?? "", "After data")
                    }
                    className="gap-1"
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0">
              <ScrollArea className="h-[600px] px-6 pb-6">
                {hasAfter ? (
                  <pre className="text-sm bg-muted p-4 rounded-md overflow-x-auto font-mono">
                    {formattedAfter}
                  </pre>
                ) : (
                  <div className="text-center text-muted-foreground py-16">
                    <span className="text-lg">No after state available</span>
                    <p className="text-sm mt-2">
                      This is likely a DELETE operation
                    </p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}
    </FullHeightDialog>
  );
}
