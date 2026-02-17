interface DataComparisonProps {
  original: string;
  edited: string;
}

interface DiffResult {
  type: "unchanged" | "addition" | "deletion" | "changed";
  content?: string;
  original?: string;
  added?: string;
  remaining?: string;
  deleted?: string;
  edited?: string;
}

export function DataComparison({ original, edited }: DataComparisonProps) {
  // Simple diff algorithm to highlight changes
  const getDiff = (originalText: string, editedText: string): DiffResult => {
    if (originalText === editedText) {
      return {
        type: "unchanged",
        content: editedText
      };
    }

    // Check if edited text contains original text (addition)
    if (editedText.includes(originalText) && editedText !== originalText) {
      const addedPart = editedText.replace(originalText, "");
      return {
        type: "addition",
        original: originalText,
        added: addedPart
      };
    }

    // Check if original text contains edited text (deletion)
    if (originalText.includes(editedText) && originalText !== editedText) {
      const deletedPart = originalText.replace(editedText, "");
      return {
        type: "deletion",
        remaining: editedText,
        deleted: deletedPart
      };
    }

    // Complete change
    return {
      type: "changed",
      original: originalText,
      edited: editedText
    };
  };

  const diff = getDiff(original, edited);

  return (
    <div className="space-y-2">
      {/* Original Data */}
      <div className="text-xs text-muted-foreground">Original:</div>
      <div className="p-2 bg-red-50 border border-red-200 rounded text-sm">
        <span className="line-through text-red-700">{original}</span>
      </div>

      {/* Edited Data */}
      <div className="text-xs text-muted-foreground">Edited:</div>
      <div className="p-2 rounded text-sm">
        {diff.type === "unchanged" && (
          <div className="bg-green-50 border border-green-200 p-2 rounded">
            <span className="text-green-700">{diff.content}</span>
          </div>
        )}

        {diff.type === "addition" && (
          <div className="bg-blue-50 border border-blue-200 p-2 rounded">
            <span className="text-green-700">{diff.original}</span>
            <span className="bg-green-200 text-green-800 px-1 rounded">
              {diff.added}
            </span>
          </div>
        )}

        {diff.type === "deletion" && (
          <div className="bg-orange-50 border border-orange-200 p-2 rounded">
            <span className="text-green-700">{diff.remaining}</span>
          </div>
        )}

        {diff.type === "changed" && (
          <div className="bg-blue-50 border border-blue-200 p-2 rounded">
            <span className="text-blue-700">{diff.edited}</span>
          </div>
        )}
      </div>
    </div>
  );
}
