
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label
} from "@packages/ui";
import type { NormalizedExtractionSchema } from "@packages/types";
import { Calendar, FileJson, Hash } from "lucide-react";

interface SchemaDetailsProps {
  schema: NormalizedExtractionSchema;
}

export function SchemaDetails({ schema }: SchemaDetailsProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getPropertyCount = () => {
    if (schema.compiledJsonSchema?.properties) {
      return Object.keys(schema.compiledJsonSchema.properties).length;
    }
    return 0;
  };

  return (
    <div className="space-y-6">
      {/* Schema Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">{schema.name}</CardTitle>
              <CardDescription className="mt-2 flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <Hash className="h-4 w-4" />
                  Version {schema.version}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  Created {formatDate(schema.createdAt)}
                </span>
              </CardDescription>
            </div>
            <Badge variant="outline" className="h-fit">
              <FileJson className="h-4 w-4 mr-1" />
              {getPropertyCount()}{" "}
              {getPropertyCount() === 1 ? "Property" : "Properties"}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Extraction Prompt */}
      {schema.prompt && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Extraction Prompt</CardTitle>
            <CardDescription>
              Instructions provided to the AI for data extraction
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-muted p-4">
              <p className="text-sm whitespace-pre-wrap">{schema.prompt}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Schema Definition */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Schema Definition</CardTitle>
          <CardDescription>
            JSON Schema structure for data extraction
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-slate-950 p-4">
            <pre className="text-sm text-slate-50 overflow-auto max-h-96">
              {JSON.stringify(schema.compiledJsonSchema, null, 2)}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Examples */}
      {schema.examples && schema.examples.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Examples</CardTitle>
            <CardDescription>
              Sample data that follows this schema structure
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {schema.examples.map((example, index) => (
              <div key={index}>
                <Label className="text-sm text-muted-foreground mb-2 block">
                  Example {index + 1}
                </Label>
                <div className="rounded-lg bg-slate-950 p-4">
                  <pre className="text-sm text-slate-50 overflow-auto">
                    {JSON.stringify(example, null, 2)}
                  </pre>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
