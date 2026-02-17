import type {
  NormalizedExtractionSchema,
  SchemaProperty
} from "@packages/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@packages/ui";
import { Clock, Copy, Eye, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { CreateSchemaMenu } from "./CreateSchemaMenu";

interface SchemaTableProps {
  schemas: NormalizedExtractionSchema[];
  loading: boolean;
  onView: (schema: NormalizedExtractionSchema) => void;
  onEdit: (schema: NormalizedExtractionSchema) => void;
  onDelete: (schema: NormalizedExtractionSchema) => void;
  onViewHistory: (schema: NormalizedExtractionSchema) => void;
  onDuplicate: (schema: NormalizedExtractionSchema) => void;
  onCreateManual: () => void;
  onGenerateWithAI: (data: {
    properties: SchemaProperty[];
    prompt: string;
    examples: Record<string, unknown>[];
  }) => void;
}

export function SchemaTable({
  schemas,
  loading,
  onView,
  onEdit,
  onDelete,
  onViewHistory,
  onDuplicate,
  onCreateManual,
  onGenerateWithAI
}: SchemaTableProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Extraction Schemas</CardTitle>
          <CardDescription>Loading schemas...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const latestSchemas = Array.from(
    new Map(
      schemas
        .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
        .map((schema) => [schema.schemaIdentifier, schema])
    ).values()
  ).sort((a, b) => (b.version ?? 0) - (a.version ?? 0));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Extraction Schemas</CardTitle>
            <CardDescription>
              Manage extraction schemas for your organization
            </CardDescription>
          </div>
          <CreateSchemaMenu
            onCreateManual={onCreateManual}
            onGenerateWithAI={onGenerateWithAI}
          />
        </div>
      </CardHeader>
      <CardContent>
        {latestSchemas.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground mb-4">
              No extraction schemas found. Create your first schema to get
              started.
            </p>
            <CreateSchemaMenu
              onCreateManual={onCreateManual}
              onGenerateWithAI={onGenerateWithAI}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50%]">Name</TableHead>
                  <TableHead className="w-[15%]">Version</TableHead>
                  <TableHead className="w-[25%]">Updated At</TableHead>
                  <TableHead className="w-[10%] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latestSchemas.map((schema) => (
                  <TableRow key={schema.id}>
                    <TableCell className="font-medium max-w-0">
                      <div className="truncate" title={schema.name}>
                        {schema.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">v{schema.version}</Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(schema.updatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2" align="end">
                          <div className="flex flex-col gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="justify-start gap-2"
                              onClick={() => onView(schema)}
                            >
                              <Eye className="h-4 w-4" />
                              View Details
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="justify-start gap-2"
                              onClick={() => onViewHistory(schema)}
                            >
                              <Clock className="h-4 w-4" />
                              Version History
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="justify-start gap-2"
                              onClick={() => onEdit(schema)}
                            >
                              <Pencil className="h-4 w-4" />
                              Edit Schema
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="justify-start gap-2"
                              onClick={() => onDuplicate(schema)}
                            >
                              <Copy className="h-4 w-4" />
                              Duplicate Schema
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="justify-start gap-2 text-destructive hover:text-destructive"
                              onClick={() => onDelete(schema)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete Schema
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
