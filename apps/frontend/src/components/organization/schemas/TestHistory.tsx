
import { Button, Card, CardContent } from "@packages/ui";
import { FileText, Trash2 } from "lucide-react";
import {
  deleteTestResult,
  formatTestTimestamp,
  type StoredTestResult
} from "@/lib/test-history";

interface TestHistoryProps {
  history: StoredTestResult[];
  onLoadTest: (test: StoredTestResult) => void;
  onDeleteTest: (testId: string) => void;
}

export function TestHistory({
  history,
  onLoadTest,
  onDeleteTest
}: TestHistoryProps) {
  if (history.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground text-center">
            No previous tests. Run a test to see history here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium mb-3">Recent Tests (Last 10)</h3>
      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {history.map((test) => (
          <div
            key={test.id}
            className="hover:bg-accent/50 transition-colors rounded border border-border p-1.5"
          >
            <div className="flex items-center justify-between gap-1 min-h-0">
              <div className="flex items-center gap-1 flex-1 min-w-0 text-xs">
                <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <span className="font-medium truncate max-w-[100px]">
                  {test.fileName}
                </span>
                <span className="text-muted-foreground">•</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {formatTestTimestamp(test.timestamp)}
                </span>
                <span className="text-muted-foreground">•</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {test.results.length} result
                  {test.results.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onLoadTest(test)}
                  className="h-5 px-1.5 text-xs"
                >
                  Load
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    deleteTestResult(test.id);
                    onDeleteTest(test.id);
                  }}
                  className="h-5 w-5 p-0"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
