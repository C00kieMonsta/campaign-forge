import { type Client } from "@packages/types";
import { Button, Card, CardContent } from "@packages/ui";
import { Edit, Plus, Trash2 } from "lucide-react";
import { DataTable, EmptyState } from "@/components/common";

interface ClientTableProps {
  clients: Client[];
  loading?: boolean;
  onEdit: (client: Client) => void;
  onDelete: (client: Client) => void;
  onCreate: () => void;
}

export function ClientTable({
  clients,
  loading,
  onEdit,
  onDelete,
  onCreate
}: ClientTableProps) {
  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  };

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (client: Client) => (
        <span className="font-medium">{client.name}</span>
      )
    },
    {
      key: "description",
      header: "Description",
      render: (client: Client) => (
        <span className="max-w-md truncate">
          {client.description || "No description"}
        </span>
      )
    },
    {
      key: "createdAt",
      header: "Created",
      render: (client: Client) => formatDate(client.createdAt)
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

  const mobileCardRender = (client: Client) => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm truncate">{client.name}</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Created: {formatDate(client.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(client)}
              className="h-8 w-8 p-0"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(client)}
              className="h-8 w-8 p-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {client.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {client.description}
          </p>
        )}
      </CardContent>
    </Card>
  );

  const emptyState = (
    <EmptyState
      icon={Plus}
      title="No clients yet"
      description="Get started by creating your first client"
      action={{
        label: "Create Client",
        onClick: onCreate
      }}
    />
  );

  const headerActions = (
    <Button onClick={onCreate}>
      <Plus className="h-4 w-4 mr-2" />
      New Client
    </Button>
  );

  return (
    <DataTable
      title={`Clients (${clients.length})`}
      description="Manage and organize your clients"
      data={clients}
      columns={columns}
      actions={actions}
      loading={!!loading}
      emptyState={emptyState}
      headerActions={headerActions}
      getRowKey={(client) => client.id}
      mobileCardRender={mobileCardRender}
    />
  );
}
