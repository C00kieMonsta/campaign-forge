
import { useState } from "react";
import { Button, ScrollArea } from "@packages/ui";
import { Copy, X } from "lucide-react";

interface SchemaViewerProps {
  schema: {
    id: string;
    name: string;
    version: number;
    definition: Record<string, unknown>;
    createdAt: string;
  };
  onClose: () => void;
}

export function SchemaViewer({ schema, onClose }: SchemaViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(schema.definition, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">{schema.name}</h3>
          <p className="text-sm text-muted-foreground">
            Version {schema.version} • Created{" "}
            {new Date(schema.createdAt).toLocaleDateString()}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex justify-between items-center">
        <p className="text-sm font-medium">Schema Definition</p>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          <Copy className="h-4 w-4 mr-2" />
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>

      <ScrollArea className="h-[500px] w-full rounded-md border">
        <pre className="p-4 text-sm">
          <code>{JSON.stringify(schema.definition, null, 2)}</code>
        </pre>
      </ScrollArea>
    </div>
  );
}
