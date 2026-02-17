
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@packages/ui";
import type { AgentExecutionMetadata as AgentMetadata } from "@packages/types";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";

interface AgentExecutionMetadataProps {
  metadata: AgentMetadata[];
}

export function AgentExecutionMetadata({
  metadata
}: AgentExecutionMetadataProps) {
  if (!metadata || metadata.length === 0) {
    return null;
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-destructive" />;
      case "timeout":
        return <Clock className="w-4 h-4 text-orange-500" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return (
          <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
            Success
          </Badge>
        );
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "timeout":
        return (
          <Badge className="bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20">
            Timeout
          </Badge>
        );
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const hasErrors = metadata.some((m) => m.status !== "success");

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Agent Pipeline Execution</CardTitle>
          {hasErrors && (
            <Badge variant="outline" className="text-orange-600">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Completed with warnings
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {metadata.map((agent, index) => (
            <div
              key={`${agent.agentName}-${index}`}
              className="border border-border rounded-lg p-4 bg-muted/30"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Badge
                    variant="outline"
                    className="text-xs font-mono flex-shrink-0"
                  >
                    {agent.agentOrder}
                  </Badge>
                  <h4 className="text-sm font-semibold text-foreground truncate">
                    {agent.agentName}
                  </h4>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {getStatusIcon(agent.status)}
                  {getStatusBadge(agent.status)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium">Duration:</span>{" "}
                  {(agent.durationMs / 1000).toFixed(2)}s
                </div>
                <div>
                  <span className="font-medium">Executed:</span>{" "}
                  {new Date(agent.executedAt).toLocaleString()}
                </div>
              </div>

              {agent.error && (
                <div className="mt-3 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive">
                  <span className="font-medium">Error:</span> {agent.error}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Total agents executed: {metadata.length}</span>
            <span>
              Total duration:{" "}
              {(
                metadata.reduce((sum, m) => sum + m.durationMs, 0) / 1000
              ).toFixed(2)}
              s
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
