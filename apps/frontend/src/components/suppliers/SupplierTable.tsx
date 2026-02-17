import type { Supplier } from "@packages/types";
import { Badge, Button, Card, CardContent } from "@packages/ui";
import { Download, Edit, Plus, Trash2, Upload } from "lucide-react";
import { DataTable, EmptyState } from "@/components/common";

interface SupplierTableProps {
  suppliers: Supplier[];
  loading?: boolean;
  onEdit: (supplier: Supplier) => void;
  onDelete: (supplier: Supplier) => void;
  onCreate: () => void;
  onImport?: () => void;
  onExport?: () => void;
}

export function SupplierTable({
  suppliers,
  loading,
  onEdit,
  onDelete,
  onCreate,
  onImport,
  onExport
}: SupplierTableProps) {
  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return "—";
    const dateObj = typeof date === "string" ? new Date(date) : date;
    if (!dateObj || isNaN(dateObj.getTime())) return "—";
    return dateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  };

  const formatMaterials = (materials: unknown) => {
    if (!materials) return "None";
    if (Array.isArray(materials)) {
      return materials.length > 0
        ? materials.slice(0, 3).join(", ") + (materials.length > 3 ? "..." : "")
        : "None";
    }
    return "None";
  };

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (supplier: Supplier) => (
        <span className="font-medium">{supplier.name}</span>
      )
    },
    {
      key: "contactEmail",
      header: "Contact Email",
      render: (supplier: Supplier) => (
        <span className="text-sm">{supplier.contactEmail}</span>
      )
    },
    {
      key: "contactPhone",
      header: "Phone",
      render: (supplier: Supplier) => (
        <span className="text-sm">{supplier.contactPhone || "—"}</span>
      )
    },
    {
      key: "materialsOffered",
      header: "Materials",
      render: (supplier: Supplier) => (
        <span className="text-sm text-muted-foreground">
          {formatMaterials(supplier.materialsOffered)}
        </span>
      )
    },
    {
      key: "createdAt",
      header: "Created",
      render: (supplier: Supplier) => (
        <span className="text-sm">{formatDate(supplier.createdAt)}</span>
      )
    }
  ];

  const actions = [
    {
      label: "Edit",
      icon: <Edit className="h-4 w-4" />,
      onClick: onEdit,
      variant: "ghost" as const
    },
    {
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      onClick: onDelete,
      variant: "ghost" as const
    }
  ];

  const mobileCardRender = (supplier: Supplier) => {
    const materials = Array.isArray(supplier.materialsOffered)
      ? supplier.materialsOffered
      : [];

    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm truncate">{supplier.name}</h4>
              <p className="text-xs text-muted-foreground mt-1">
                {supplier.contactEmail}
              </p>
              {supplier.contactPhone && (
                <p className="text-xs text-muted-foreground">
                  {supplier.contactPhone}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(supplier)}
                className="h-8 w-8 p-0"
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(supplier)}
                className="h-8 w-8 p-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {materials.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {materials.slice(0, 3).map((material, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {String(material)}
                </Badge>
              ))}
              {materials.length > 3 && (
                <Badge variant="outline" className="text-xs">
                  +{materials.length - 3} more
                </Badge>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Created: {formatDate(supplier.createdAt)}
          </p>
        </CardContent>
      </Card>
    );
  };

  const emptyState = (
    <EmptyState
      icon={Plus}
      title="No suppliers yet"
      description="Get started by creating your first supplier or importing from CSV"
      action={{
        label: "Create Supplier",
        onClick: onCreate
      }}
    />
  );

  const headerActions = (
    <div className="flex gap-2">
      {onExport && (
        <Button variant="outline" onClick={onExport}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      )}
      {onImport && (
        <Button variant="outline" onClick={onImport}>
          <Upload className="h-4 w-4 mr-2" />
          Import CSV
        </Button>
      )}
      <Button onClick={onCreate}>
        <Plus className="h-4 w-4 mr-2" />
        New Supplier
      </Button>
    </div>
  );

  return (
    <DataTable
      title={`Suppliers (${suppliers.length})`}
      description="Manage your organization's suppliers and their contact information"
      data={suppliers}
      columns={columns}
      actions={actions}
      loading={loading ?? false}
      emptyState={emptyState}
      headerActions={headerActions}
      getRowKey={(supplier) => supplier.id}
      mobileCardRender={mobileCardRender}
    />
  );
}
