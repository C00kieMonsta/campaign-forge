
import { Button, Card, CardContent } from "@packages/ui";
import { AlertCircle } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryText?: string;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryText = "Try Again",
  className
}: ErrorStateProps) {
  return (
    <Card className={className}>
      <CardContent className="p-6">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {title}
          </h3>
          <p className="text-muted-foreground mb-6">{message}</p>
          {onRetry && (
            <Button onClick={onRetry} variant="outline">
              {retryText}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
