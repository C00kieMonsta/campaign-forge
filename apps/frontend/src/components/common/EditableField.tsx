import { Button, Input, Textarea } from "@packages/ui";

interface EditableFieldProps {
  label: string;
  value: string | number | undefined;
  placeholder?: string;
  isEditing: boolean;
  editValue: string;
  fieldType?: "input" | "textarea" | "number" | "select";
  selectOptions?: Array<{ value: string; label: string }>;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditValueChange: (value: string) => void;
  rows?: number;
  className?: string;
}

export function EditableField({
  label,
  value,
  placeholder = "Not specified",
  isEditing,
  editValue,
  fieldType = "input",
  selectOptions,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditValueChange,
  rows = 2,
  className = ""
}: EditableFieldProps) {
  const displayValue = value || placeholder;

  return (
    <div className={className}>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      {isEditing ? (
        <div className="flex gap-1 mt-1">
          {fieldType === "textarea" ? (
            <Textarea
              value={editValue}
              onChange={(e) => onEditValueChange(e.target.value)}
              className="text-sm"
              rows={rows}
              autoFocus
            />
          ) : fieldType === "number" ? (
            <Input
              type="number"
              step="0.01"
              value={editValue}
              onChange={(e) => onEditValueChange(e.target.value)}
              className="text-sm"
              autoFocus
            />
          ) : fieldType === "select" ? (
            <select
              value={editValue}
              onChange={(e) => onEditValueChange(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1 flex-1"
              autoFocus
            >
              <option value="">Select unit...</option>
              {selectOptions?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={editValue}
              onChange={(e) => onEditValueChange(e.target.value)}
              className="text-sm"
              autoFocus
            />
          )}
          <div className="flex flex-col gap-1">
            <Button size="sm" onClick={onSaveEdit}>
              ✓
            </Button>
            <Button size="sm" variant="outline" onClick={onCancelEdit}>
              ✕
            </Button>
          </div>
        </div>
      ) : (
        <p
          className="text-sm cursor-pointer hover:bg-gray-100 p-1 rounded mt-1 border border-gray-100"
          onClick={onStartEdit}
        >
          {displayValue}
        </p>
      )}
    </div>
  );
}
