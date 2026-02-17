// apps/frontend/src/components/common/Selector.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@packages/ui";

export interface OptionSelectorProps<T extends Record<string, any>> {
  /** Current selected value ID (string, not the full object) */
  value?: string;
  label: string;
  placeholder?: string;
  loadingText?: string;
  isLoading?: boolean;
  options: T[];
  getDisplayText: (option: T) => string;
  getOptionId: (option: T) => string;
  getSecondaryText?: (option: T) => string | null;
  onChange: (optionId: string) => void;
  triggerClassName?: string;
  containerClassName?: string;
}

/**
 * Reusable option selector component with built-in display of selected value
 *
 * Features:
 * - Shows the selected value in the trigger (not just placeholder)
 * - Supports loading state
 * - Flexible option rendering with display text and secondary text
 * - Type-safe with generics
 *
 * @example
 * <OptionSelector
 *   value={selectedSupplierId}
 *   label="Supplier:"
 *   options={supplierMatches}
 *   getDisplayText={(match) => match.supplier.name}
 *   getOptionId={(match) => match.supplierId}
 *   getSecondaryText={(match) =>
 *     match.confidenceScore
 *       ? `${(match.confidenceScore * 100).toFixed(0)}%`
 *       : null
 *   }
 *   onChange={onSelectSupplier}
 *   isLoading={isSelecting}
 * />
 */
export function OptionSelector<T extends Record<string, any>>({
  value,
  label,
  placeholder = "Select option...",
  loadingText = "Loading...",
  isLoading = false,
  options,
  getDisplayText,
  getOptionId,
  getSecondaryText,
  onChange,
  triggerClassName = "h-7 w-[180px] text-xs",
  containerClassName = "flex items-center space-x-1"
}: OptionSelectorProps<T>): React.ReactNode {
  // Find the display text for the currently selected value
  const selectedOption = value
    ? options.find((opt) => getOptionId(opt) === value)
    : undefined;
  const displayValue = selectedOption
    ? getDisplayText(selectedOption)
    : placeholder;

  return (
    <div className={containerClassName}>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <Select value={value || ""} disabled={isLoading} onValueChange={onChange}>
        <SelectTrigger className={triggerClassName}>
          <SelectValue placeholder={isLoading ? loadingText : displayValue} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => {
            const optionId = getOptionId(option);
            const displayText = getDisplayText(option);
            const secondaryText = getSecondaryText?.(option);

            return (
              <SelectItem key={optionId} value={optionId} className="text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span>{displayText}</span>
                  {secondaryText && (
                    <span className="ml-2 text-muted-foreground text-xs">
                      {secondaryText}
                    </span>
                  )}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
