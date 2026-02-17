
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@packages/ui";
import type { NormalizedExtractionSchema } from "@packages/types";
import { CheckCircle2, Eye, RotateCcw } from "lucide-react";

interface SchemaVersionHistoryProps {
  versions: NormalizedExtractionSchema[];
  currentVersionId: string;
  loading: boolean;
  onViewVersion: (version: NormalizedExtractionSchema) => void;
  onRestoreVersion: (version: NormalizedExtractionSchema) => void;
}

export function SchemaVersionHistory({
  versions,
  currentVersionId,
  loading,
  onViewVersion,
  onRestoreVersion
}: SchemaVersionHistoryProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted-foreground">
          No version history available.
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Version History</CardTitle>
        <CardDescription>
          All versions of this schema (newest first)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Changes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((version) => {
                const isCurrent = version.id === currentVersionId;
                return (
                  <TableRow
                    key={version.id}
                    className={isCurrent ? "bg-muted/50" : ""}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={isCurrent ? "default" : "secondary"}>
                          v{version.version}
                        </Badge>
                        {isCurrent && (
                          <Badge variant="outline" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Current
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {version.name}
                    </TableCell>
                    <TableCell className="max-w-md">
                      <span className="text-sm text-muted-foreground">
                        {version.changeDescription ||
                          (version.version === 1
                            ? "Initial version"
                            : "No description")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">
                          {new Date(version.createdAt).toLocaleDateString()}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(version.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onViewVersion(version)}
                          title="View this version"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {!isCurrent && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRestoreVersion(version)}
                            title="Create new version from this"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
