
import { Badge, Textarea } from "@packages/ui";
import { Info } from "lucide-react";

interface PromptEditorProps {
  prompt: string;
  onChange: (prompt: string) => void;
}

export function PromptEditor({ prompt, onChange }: PromptEditorProps) {
  const charCount = prompt.length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Custom Extraction Prompt
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Define a custom prompt to guide the AI in extracting data. The
            schema and examples will be automatically included in the extraction
            request.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">
          {charCount.toLocaleString()} characters
        </Badge>
      </div>

      <Textarea
        id="extraction-prompt"
        value={prompt}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Extract the following information from the document..."
        className="min-h-[400px] font-mono text-sm bg-muted/20 resize-none"
      />

      <div className="flex items-start gap-2 p-4 bg-muted/50 border border-border rounded-lg">
        <div className="text-primary mt-0.5">
          <Info className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-foreground font-medium">
            Prompt Best Practices
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Be specific about extraction rules, field requirements, and data
            formatting. Reference property names using their exact field names
            (e.g., &apos;itemName&apos;, &apos;quantity&apos;).
          </p>
        </div>
      </div>
    </div>
  );
}
