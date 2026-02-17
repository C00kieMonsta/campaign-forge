import { useCallback, useMemo, useState } from "react";
import { TABLE_NAMES } from "@packages/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@packages/ui";
import { format } from "date-fns";
import {
  Activity,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  Filter,
  RefreshCw,
  User
} from "lucide-react";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import {
  useAuditLogs,
  useDefaultAuditLogDateRange,
  type AuditLog,
  type AuditLogFilters
} from "@/hooks/use-audit-logs";

interface AuditLogsTableProps {
  onViewDetails?: (log: AuditLog) => void;
}

const ITEMS_PER_PAGE = 25;

export function AuditLogsTable({ onViewDetails }: AuditLogsTableProps) {
  const defaultDateRange = useDefaultAuditLogDateRange();
  const availableTables = [
    TABLE_NAMES.ORGANIZATIONS,
    TABLE_NAMES.USERS,
    TABLE_NAMES.ORGANIZATION_MEMBERS,
    TABLE_NAMES.ROLES,
    TABLE_NAMES.INVITATIONS,
    TABLE_NAMES.CLIENTS,
    TABLE_NAMES.PROJECTS,
    TABLE_NAMES.DATA_LAYERS,
    TABLE_NAMES.EXTRACTION_JOBS,
    TABLE_NAMES.EXTRACTION_RESULTS
  ];
  const availableActions = ["create", "update", "delete", "upsert"];

  // Filters state
  const [filters, setFilters] = useState<AuditLogFilters>({
    startDate: defaultDateRange.startDate,
    endDate: defaultDateRange.endDate,
    limit: ITEMS_PER_PAGE,
    offset: 0
  });

  // UI state
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch audit logs
  const { data, isLoading, error, refetch, isRefetching } =
    useAuditLogs(filters);

  // Update filter with pagination reset
  const updateFilters = useCallback((newFilters: Partial<AuditLogFilters>) => {
    setCurrentPage(1);
    setFilters((prev: AuditLogFilters) => ({
      ...prev,
      ...newFilters,
      offset: 0 // Reset to first page
    }));
  }, []);

  // Handle pagination
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    setFilters((prev: AuditLogFilters) => ({
      ...prev,
      offset: (page - 1) * ITEMS_PER_PAGE
    }));
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    const clearedFilters: AuditLogFilters = {
      startDate: defaultDateRange.startDate,
      endDate: defaultDateRange.endDate,
      limit: ITEMS_PER_PAGE,
      offset: 0
    };
    setFilters(clearedFilters);
    setCurrentPage(1);
  }, [defaultDateRange]);

  // Calculate pagination info
  const totalPages = data ? Math.ceil(data.total / ITEMS_PER_PAGE) : 0;
  const hasNextPage = data?.hasMore || false;
  const hasPrevPage = currentPage > 1;

  // Format action badge color
  const getActionBadgeVariant = (action: string) => {
    switch (action.toLowerCase()) {
      case "create":
        return "default";
      case "update":
        return "secondary";
      case "delete":
        return "destructive";
      case "upsert":
        return "outline";
      default:
        return "outline";
    }
  };

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.actorEmail?.trim()) count++;
    if (filters.actorName?.trim()) count++;
    if (filters.targetTable?.trim()) count++;
    if (filters.action?.trim()) count++;
    return count;
  }, [filters]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Audit Logs</h2>
            <Badge variant="outline" className="text-xs">
              Loading...
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled className="gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading...
            </Button>
          </div>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (error) {
    const isAccessDenied =
      (error as { response?: { status?: number } })?.response?.status === 403;

    return (
      <ErrorState
        title={isAccessDenied ? "Access Denied" : "Failed to Load Audit Logs"}
        message={
          isAccessDenied
            ? "You need Admin privileges to view audit logs."
            : "Unable to fetch audit logs. Please try again."
        }
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with filters toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Audit Logs</h2>
          <Badge variant="outline" className="text-xs">
            {data?.total || 0} total
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeFiltersCount > 0 && (
              <Badge variant="destructive" className="ml-1">
                {activeFiltersCount}
              </Badge>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="gap-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filter Audit Logs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Date Range */}
              <div className="space-y-2">
                <Label htmlFor="start-date" className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Start Date
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  value={filters.startDate || ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateFilters({ startDate: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="end-date" className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  End Date
                </Label>
                <Input
                  id="end-date"
                  type="date"
                  value={filters.endDate || ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateFilters({ endDate: e.target.value })
                  }
                />
              </div>

              {/* User Filters */}
              <div className="space-y-2">
                <Label htmlFor="actor-name" className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  User Name
                </Label>
                <Input
                  id="actor-name"
                  placeholder="Search by name..."
                  value={filters.actorName || ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateFilters({ actorName: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="actor-email"
                  className="flex items-center gap-1"
                >
                  <User className="h-3 w-3" />
                  User Email
                </Label>
                <Input
                  id="actor-email"
                  placeholder="Search by email..."
                  value={filters.actorEmail || ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateFilters({ actorEmail: e.target.value })
                  }
                />
              </div>

              {/* Table and Action Filters */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  Table
                </Label>
                <Select
                  value={filters.targetTable || "all"}
                  onValueChange={(value) =>
                    updateFilters({
                      targetTable: value === "all" ? undefined : value
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All tables" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tables</SelectItem>
                    {availableTables.map((table) => (
                      <SelectItem key={table} value={table}>
                        {table}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  Action
                </Label>
                <Select
                  value={filters.action || "all"}
                  onValueChange={(value) =>
                    updateFilters({
                      action: value === "all" ? undefined : value
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    {availableActions.map((action) => (
                      <SelectItem key={action} value={action}>
                        {action}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                disabled={activeFiltersCount === 0}
              >
                Clear Filters
              </Button>
              <span className="text-sm text-muted-foreground">
                Showing {data?.logs.length || 0} of {data?.total || 0} logs
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit Logs Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date & Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Table</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <div className="text-muted-foreground">
                      <Activity className="mx-auto h-8 w-8 mb-2 opacity-50" />
                      <p>No audit logs found for the selected criteria.</p>
                      <p className="text-sm">
                        Try adjusting your filters or date range.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                data?.logs.map((log: AuditLog) => {
                  const hasChanges = Boolean(log.before) || Boolean(log.after);
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-sm">
                        {format(
                          new Date(log.occurredAt),
                          "MMM dd, yyyy HH:mm:ss"
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {log.actorDisplayName}
                          </span>
                          {log.actorEmail && (
                            <span className="text-xs text-muted-foreground">
                              {log.actorEmail}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionBadgeVariant(log.action)}>
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {log.targetTable}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {hasChanges && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onViewDetails?.(log)}
                            className="gap-1"
                          >
                            <Eye className="h-3 w-3" />
                            View Changes
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={!hasPrevPage}
              className="gap-1"
            >
              <ChevronLeft className="h-3 w-3" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={!hasNextPage}
              className="gap-1"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
