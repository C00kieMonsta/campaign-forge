
import { useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea
} from "@packages/ui";
import type { AgentDefinition, AgentExecutionMetadata } from "@packages/types";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

interface AgentTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentDefinition;
}

interface TestResult {
  output: unknown;
  metadata: AgentExecutionMetadata;
}

export function AgentTestDialog({
  open,
  onOpenChange,
  agent
}: AgentTestDialogProps) {
  const [inputData, setInputData] = useState(
    JSON.stringify(
      {
        items: [
          { name: "Widget A", qty: 5 },
          { name: "Widget A", qty: 3 },
          { name: "Widget B", qty: 2 }
        ]
      },
      null,
      2
    )
  );
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRunTest = async () => {
    setIsLoading(true);
    setError(null);
    setTestResult(null);

    try {
      // Validate JSON input
      let parsedInput;
      try {
        parsedInput = JSON.parse(inputData);
      } catch (e) {
        setError("Invalid JSON input. Please check your syntax.");
        setIsLoading(false);
        return;
      }

      // Call the test agent API endpoint
      const response = await fetch("/api/extraction/schemas/test-agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          agent,
          inputData: parsedInput
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to test agent");
      }

      const result = await response.json();
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-destructive" />;
      case "timeout":
        return <Clock className="w-5 h-5 text-orange-500" />;
      default:
        return null;
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
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Agent: {agent.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Sample Input Data */}
          <div className="space-y-2">
            <Label htmlFor="test-input">Sample Input Data</Label>
            <Textarea
              id="test-input"
              value={inputData}
              onChange={(e) => setInputData(e.target.value)}
              placeholder='{"items": [...]}'
              rows={10}
              className="font-mono text-sm bg-muted/20"
            />
            <p className="text-xs text-muted-foreground">
              Paste JSON data to test the agent transformation
            </p>
          </div>

          {/* Run Test Button */}
          <div>
            <Button
              onClick={handleRunTest}
              disabled={isLoading || !inputData.trim()}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running Test...
                </>
              ) : (
                "Run Test"
              )}
            </Button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <div className="flex items-start gap-2">
                <XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">Error</p>
                  <p className="text-sm text-destructive/90 mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Test Results */}
          {testResult && (
            <div className="space-y-3 p-4 bg-muted/30 border border-border rounded-lg">
              <h4 className="text-sm font-semibold text-foreground">
                Test Results
              </h4>

              {/* Status and Duration */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  {getStatusIcon(testResult.metadata.status)}
                  <span className="text-sm font-medium">Status:</span>
                  {getStatusBadge(testResult.metadata.status)}
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Duration:{" "}
                    {(testResult.metadata.durationMs / 1000).toFixed(2)}s
                  </span>
                </div>
              </div>

              {/* Error Message (if failed) */}
              {testResult.metadata.error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded">
                  <p className="text-sm text-destructive">
                    {testResult.metadata.error}
                  </p>
                </div>
              )}

              {/* Output */}
              <div className="space-y-2">
                <Label>Output:</Label>
                <div className="p-3 bg-muted/50 border border-border rounded-lg overflow-x-auto">
                  <pre className="text-xs font-mono whitespace-pre-wrap">
                    {JSON.stringify(testResult.output, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
