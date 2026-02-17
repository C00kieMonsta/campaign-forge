import { type ReactNode } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@packages/ui";

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => ReactNode;
  className?: string;
}

interface Action<T> {
  label: string;
  icon?: ReactNode;
  onClick: (item: T) => void;
  variant?: "default" | "destructive" | "ghost" | "outline";
  disabled?: (item: T) => boolean;
}

interface DataTableProps<T> {
  title?: string;
  description?: string;
  data: T[];
  columns: Column<T>[];
  actions?: Action<T>[];
  loading?: boolean;
  emptyState?: ReactNode;
  headerActions?: ReactNode;
  getRowKey: (item: T) => string;
  mobileCardRender?: (item: T, actions?: Action<T>[]) => ReactNode;
}

export function DataTable<T>({
  title,
  description,
  data,
  columns,
  actions,
  loading,
  emptyState,
  headerActions,
  getRowKey,
  mobileCardRender
}: DataTableProps<T>) {
  const renderCellContent = (item: T, column: Column<T>) => {
    if (column.render) {
      return column.render(item);
    }

    const value = item[column.key as keyof T];
    return value as ReactNode;
  };

  const renderActions = (item: T) => {
    if (!actions || actions.length === 0) return null;

    return (
      <div className="flex items-center gap-2">
        {actions.map((action, index) => (
          <Button
            key={index}
            variant={action.variant || "ghost"}
            size="sm"
            onClick={() => action.onClick(item)}
            disabled={action.disabled?.(item)}
            title={action.label}
          >
            {action.icon}
          </Button>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        {(title || description || headerActions) && (
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                {title && <CardTitle>{title}</CardTitle>}
                {description && (
                  <CardDescription>{description}</CardDescription>
                )}
              </div>
              {headerActions}
            </div>
          </CardHeader>
        )}
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="grid gap-4 py-3 border-b last:border-b-0"
                style={{
                  gridTemplateColumns: `repeat(${columns.length + (actions ? 1 : 0)}, 1fr)`
                }}
              >
                {Array.from({ length: columns.length + (actions ? 1 : 0) }).map(
                  (_, j) => (
                    <div
                      key={j}
                      className="h-4 bg-muted rounded animate-pulse"
                    />
                  )
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0 && emptyState) {
    return (
      <Card>
        {(title || description || headerActions) && (
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                {title && <CardTitle>{title}</CardTitle>}
                {description && (
                  <CardDescription>{description}</CardDescription>
                )}
              </div>
              {headerActions}
            </div>
          </CardHeader>
        )}
        <CardContent>{emptyState}</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {(title || description || headerActions) && (
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              {title && <CardTitle>{title}</CardTitle>}
              {description && <CardDescription>{description}</CardDescription>}
            </div>
            {headerActions}
          </div>
        </CardHeader>
      )}
      <CardContent>
        {/* Desktop Table */}
        <div className="hidden lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead
                    key={String(column.key)}
                    className={column.className}
                  >
                    {column.header}
                  </TableHead>
                ))}
                {actions && actions.length > 0 && (
                  <TableHead className="w-[100px]">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((item) => (
                <TableRow key={getRowKey(item)}>
                  {columns.map((column) => (
                    <TableCell
                      key={String(column.key)}
                      className={column.className}
                    >
                      {renderCellContent(item, column)}
                    </TableCell>
                  ))}
                  {actions && actions.length > 0 && (
                    <TableCell>{renderActions(item)}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile Card View */}
        <div className="lg:hidden space-y-3">
          {data.map((item) => (
            <div key={getRowKey(item)}>
              {mobileCardRender ? (
                mobileCardRender(item, actions)
              ) : (
                <Card>
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      {columns.map((column) => (
                        <div
                          key={String(column.key)}
                          className="flex justify-between"
                        >
                          <span className="text-sm text-muted-foreground">
                            {column.header}:
                          </span>
                          <span className="text-sm font-medium">
                            {renderCellContent(item, column)}
                          </span>
                        </div>
                      ))}
                      {actions && actions.length > 0 && (
                        <div className="pt-2 border-t">
                          {renderActions(item)}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
