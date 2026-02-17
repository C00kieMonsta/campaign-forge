import { useCallback, useEffect, useState, type FC } from "react";
import type { ExtractionResultStatus, SchemaProperty } from "@packages/types";
import { VERIFICATION_STATUSES } from "@packages/types";
import { Button } from "@packages/ui";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Undo2
} from "lucide-react";
import {
  ExtractionRow,
  type FlexibleExtractionResult
} from "@/components/extraction";
import { cn } from "@/lib/utils";

interface VerificationModeProps {
  extractions: FlexibleExtractionResult[];
  schemaProperties: SchemaProperty[];
  editingCell: { id: string; field: string } | null;
  editValue: string;
  updatingSupplierForRow: string | null;
  results: { id?: string; rawExtraction?: Record<string, unknown> }[];
  onStartEdit: (id: string, field: string, value: string) => void;
  onSaveEdit: () => Promise<void>;
  onCancelEdit: () => void;
  onEditValueChange: (value: string) => void;
  onStatusChange: (
    id: string,
    status: "accepted" | "pending"
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSelectSupplier: (resultId: string, supplierId: string) => Promise<void>;
}

export const VerificationMode: FC<VerificationModeProps> = ({
  extractions,
  schemaProperties,
  editingCell,
  editValue,
  updatingSupplierForRow,
  results,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditValueChange,
  onStatusChange,
  onDelete,
  onSelectSupplier
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const total = extractions.length;
  const current = extractions[currentIndex];

  const goNext = useCallback(() => {
    setCurrentIndex((prev) => Math.min(prev + 1, total - 1));
    setLastAction(null);
  }, [total]);

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
    setLastAction(null);
  }, []);

  const handleAccept = useCallback(async () => {
    if (!current) return;
    await onStatusChange(current.id, VERIFICATION_STATUSES.ACCEPTED);
    setLastAction("accepted");
    setTimeout(() => {
      setCurrentIndex((prev) => Math.min(prev + 1, total - 1));
      setLastAction(null);
    }, 400);
  }, [current, onStatusChange, total]);

  const handleUndo = useCallback(async () => {
    if (!current) return;
    await onStatusChange(current.id, VERIFICATION_STATUSES.PENDING);
    setLastAction("undone");
  }, [current, onStatusChange]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          goNext();
          break;
        case "Enter":
          e.preventDefault();
          handleAccept();
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          handleUndo();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev, handleAccept, handleUndo]);

  // Reset index when extractions change and current index is out of bounds
  useEffect(() => {
    if (currentIndex >= total) {
      setCurrentIndex(Math.max(0, total - 1));
    }
  }, [total, currentIndex]);

  if (total === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm">No extractions match the current filter.</p>
      </div>
    );
  }

  const rawResult = results.find((r) => r?.id === current.id);
  const rawData = rawResult?.rawExtraction as
    | Record<string, unknown>
    | undefined;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Progress bar */}
      <div className="px-6 pt-5 pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            Item{" "}
            <span className="font-semibold text-foreground">
              {currentIndex + 1}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-foreground">{total}</span>
          </span>
          {lastAction && (
            <span
              className={cn(
                "text-sm font-medium animate-in fade-in slide-in-from-right-2 duration-200",
                lastAction === "accepted"
                  ? "text-emerald-600"
                  : "text-amber-600"
              )}
            >
              {lastAction === "accepted" ? "Accepted!" : "Reverted to pending"}
            </span>
          )}
        </div>
        {/* Progress dots */}
        <div className="flex gap-1">
          {extractions.map((ext, i) => (
            <button
              key={ext.id}
              onClick={() => {
                setCurrentIndex(i);
                setLastAction(null);
              }}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-all",
                i === currentIndex
                  ? "bg-foreground"
                  : ext.status === "accepted"
                    ? "bg-emerald-400"
                    : "bg-border"
              )}
              aria-label={`Go to extraction ${i + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Card area */}
      <div className="flex-1 flex items-start justify-center px-6 pt-4 pb-6 overflow-y-auto">
        <div className="w-full max-w-5xl">
          <ExtractionRow
            key={current.id}
            material={current}
            schema={schemaProperties}
            editingCell={editingCell}
            editValue={editValue}
            onStartEdit={onStartEdit}
            onSaveEdit={onSaveEdit}
            onCancelEdit={onCancelEdit}
            onUpdateStatus={(status: ExtractionResultStatus) =>
              onStatusChange(
                current.id,
                status === VERIFICATION_STATUSES.ACCEPTED
                  ? VERIFICATION_STATUSES.ACCEPTED
                  : VERIFICATION_STATUSES.PENDING
              )
            }
            onEditValueChange={onEditValueChange}
            rawData={rawData}
            onDelete={onDelete}
            onSelectSupplier={onSelectSupplier}
            isSelectingSupplier={updatingSupplierForRow === current.id}
            highlighted
          />
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="border-t bg-card px-6 py-3">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          {/* Navigation buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goPrev}
              disabled={currentIndex === 0}
              className="gap-1.5 bg-transparent"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goNext}
              disabled={currentIndex === total - 1}
              className="gap-1.5 bg-transparent"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Keyboard shortcuts */}
          <div className="hidden items-center gap-5 text-xs text-muted-foreground sm:flex">
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                <ArrowLeft className="h-2.5 w-2.5" />
              </kbd>
              <kbd className="inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                <ArrowRight className="h-2.5 w-2.5" />
              </kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                Enter
              </kbd>
              Accept
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                Delete
              </kbd>
              Undo
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleUndo}
              className="gap-1.5 text-muted-foreground hover:text-foreground bg-transparent"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </Button>
            <Button
              size="sm"
              onClick={handleAccept}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Check className="h-3.5 w-3.5" />
              Accept
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
