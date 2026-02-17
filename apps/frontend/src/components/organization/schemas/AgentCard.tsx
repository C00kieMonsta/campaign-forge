import { useState } from "react";
import type { AgentDefinition } from "@packages/types";
import { Badge, Button } from "@packages/ui";
import { Edit2, GripVertical, Trash2 } from "lucide-react";

interface AgentCardProps {
  agent: AgentDefinition;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function AgentCard({
  agent,
  index,
  onEdit,
  onDelete,
  onReorder
}: AgentCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDragOverIndex(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"));
    if (fromIndex !== index) {
      onReorder(fromIndex, index);
    }
    setDragOverIndex(null);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        border border-border rounded-lg bg-card transition-all
        ${isDragging ? "opacity-50 shadow-lg" : ""}
        ${dragOverIndex === index ? "border-primary border-2" : ""}
      `}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Drag Handle */}
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors mt-1"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-5 h-5" />
        </button>

        {/* Agent Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs font-mono">
                {agent.order}
              </Badge>
              <h4 className="text-sm font-semibold text-foreground">
                {agent.name}
              </h4>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onEdit}
                className="h-8 w-8 p-0"
                aria-label="Edit agent"
              >
                <Edit2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                aria-label="Delete agent"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {agent.description && (
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
              {agent.description}
            </p>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Status:</span>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  agent.enabled ? "bg-green-500" : "bg-gray-400"
                }`}
              />
              <span className="text-xs font-medium">
                {agent.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
