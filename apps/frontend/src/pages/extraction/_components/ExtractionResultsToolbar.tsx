import { type FC } from "react";
import type { SchemaProperty } from "@packages/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@packages/ui";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckSquare,
  Download,
  List,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Users,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ExtractionResultsToolbarProps {
  jobName: string;
  totalCount: number;
  acceptedCount: number;
  pendingCount: number;
  matchedCount: number;
  unmatchedCount: number;
  matchFilter: "all" | "matched" | "unmatched";
  sortBy: string | null;
  sortDirection: "asc" | "desc";
  filterProperty: string | null;
  filterValue: string;
  schemaProperties: SchemaProperty[];
  hasSuppliers: boolean;
  isLoadingSuppliers: boolean;
  isMatching: boolean;
  onMatchFilterChange: (filter: "all" | "matched" | "unmatched") => void;
  onSortChange: (property: string | null, direction: "asc" | "desc") => void;
  onFilterChange: (property: string | null, value: string) => void;
  viewMode: "list" | "verification";
  onViewModeChange: (mode: "list" | "verification") => void;
  onMatchSuppliers: () => void;
  onOpenExport: () => void;
  onManualEntry: () => void;
  onBackToProject: () => void;
}

export const ExtractionResultsToolbar: FC<ExtractionResultsToolbarProps> = ({
  jobName,
  totalCount,
  acceptedCount,
  pendingCount,
  matchedCount,
  unmatchedCount,
  matchFilter,
  sortBy,
  sortDirection,
  filterProperty,
  filterValue,
  schemaProperties,
  hasSuppliers,
  isLoadingSuppliers,
  isMatching,
  viewMode,
  onViewModeChange,
  onMatchFilterChange,
  onSortChange,
  onFilterChange,
  onMatchSuppliers,
  onOpenExport,
  onManualEntry,
  onBackToProject
}) => {
  const hasActiveFilters =
    sortBy !== null || (filterProperty !== null && filterValue !== "");

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      {/* Left section: Back + Job Name + Filter tabs */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={onBackToProject}
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Back</span>
        </Button>

        <div className="hidden items-center gap-1.5 text-sm text-muted-foreground md:flex">
          <span className="font-medium text-foreground">{jobName}</span>
        </div>

        <div className="hidden h-4 w-px bg-border sm:block" />

        {/* Compact filter tabs */}
        <div className="flex items-center rounded-md border bg-muted/50 p-0.5 text-xs sm:text-sm">
          <button
            onClick={() => onMatchFilterChange("all")}
            className={cn(
              "rounded px-2 py-1 transition-colors whitespace-nowrap",
              matchFilter === "all"
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            All <span className="ml-1 text-xs">{totalCount}</span>
          </button>
          <button
            onClick={() => onMatchFilterChange("matched")}
            className={cn(
              "rounded px-2 py-1 transition-colors whitespace-nowrap",
              matchFilter === "matched"
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Matched <span className="ml-1 text-xs">{matchedCount}</span>
          </button>
          <button
            onClick={() => onMatchFilterChange("unmatched")}
            className={cn(
              "rounded px-2 py-1 transition-colors whitespace-nowrap",
              matchFilter === "unmatched"
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Unmatched <span className="ml-1 text-xs">{unmatchedCount}</span>
          </button>
        </div>
      </div>

      {/* Right section: Stats + Sort/Filter + Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Compact stats */}
        <div className="hidden items-center gap-3 text-sm lg:flex">
          <span className="text-muted-foreground">
            Accepted:{" "}
            <span className="font-medium text-emerald-600">
              {acceptedCount}
            </span>
          </span>
          <span className="text-muted-foreground">
            Pending:{" "}
            <span className="font-medium text-amber-600">{pendingCount}</span>
          </span>
        </div>

        <div className="hidden h-4 w-px bg-border lg:block" />

        {/* View mode toggle */}
        <div className="flex items-center rounded-md border bg-muted/50 p-0.5">
          <button
            onClick={() => onViewModeChange("list")}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors",
              viewMode === "list"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">List</span>
          </button>
          <button
            onClick={() => onViewModeChange("verification")}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors",
              viewMode === "verification"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Verify</span>
          </button>
        </div>

        <div className="hidden h-4 w-px bg-border lg:block" />

        {/* Sort & Filter popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "gap-1.5 bg-transparent",
                hasActiveFilters && "border-primary text-primary"
              )}
            >
              <SlidersHorizontal className="size-4" />
              <span className="hidden sm:inline">Sort & Filter</span>
              {hasActiveFilters && (
                <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                  {(sortBy ? 1 : 0) + (filterProperty ? 1 : 0)}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="end">
            <div className="space-y-4">
              {/* Sort Controls */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Sort by</label>
                <div className="flex gap-2">
                  <Select
                    value={sortBy || "none"}
                    onValueChange={(value) =>
                      onSortChange(
                        value === "none" ? null : value,
                        sortDirection
                      )
                    }
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {schemaProperties.map((prop) => (
                        <SelectItem key={prop.name} value={prop.name}>
                          {prop.title || prop.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {sortBy && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onSortChange(
                          sortBy,
                          sortDirection === "asc" ? "desc" : "asc"
                        )
                      }
                      className="px-3"
                    >
                      {sortDirection === "asc" ? (
                        <ArrowUp className="h-4 w-4" />
                      ) : (
                        <ArrowDown className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {/* Filter Controls */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Filter by</label>
                <Select
                  value={filterProperty || "none"}
                  onValueChange={(value) =>
                    onFilterChange(value === "none" ? null : value, filterValue)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {schemaProperties.map((prop) => (
                      <SelectItem key={prop.name} value={prop.name}>
                        {prop.title || prop.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filterProperty && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={filterValue}
                      onChange={(e) =>
                        onFilterChange(filterProperty, e.target.value)
                      }
                      placeholder="Filter value..."
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onFilterChange(null, "")}
                      className="px-3"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onSortChange(null, "asc");
                    onFilterChange(null, "");
                  }}
                  className="w-full"
                >
                  Clear All Filters
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Actions dropdown for secondary actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 bg-transparent"
            >
              <MoreHorizontal className="size-4" />
              <span className="hidden sm:inline">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onManualEntry}>
              <Plus className="size-4" />
              Add Manual Entry
            </DropdownMenuItem>
            {hasSuppliers && (
              <DropdownMenuItem
                onClick={onMatchSuppliers}
                disabled={isLoadingSuppliers || isMatching}
              >
                <Users className="size-4" />
                {isMatching
                  ? "Matching..."
                  : isLoadingSuppliers
                    ? "Loading..."
                    : "Match Suppliers"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenExport}>
              <Download className="size-4" />
              Export CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
