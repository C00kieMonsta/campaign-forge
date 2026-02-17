import { useEffect, useState } from "react";
import {
  useCollection,
  usePersistence,
  useUIState
} from "@packages/core-client";
import type { Client } from "@packages/types";
import { ClientForm } from "@/components/clients/ClientForm";
import { ClientTable } from "@/components/clients/ClientTable";
import {
  ConfirmationDialog,
  ErrorState,
  FormModal,
  PageHeaderSkeleton
} from "@/components/common";
import { useProtectedRoute } from "@/hooks/use-protected-route";

interface CreateClientData {
  name: string;
  description?: string | undefined;
}

/**
 * Clients Settings Page
 *
 * Manage all organization clients
 */
export default function ClientsSettingsPage() {
  useProtectedRoute(); // Ensure user is authenticated

  // Read from store using hooks
  const clients = useCollection("clients");
  const uiState = useUIState();
  const loading = uiState.loading.clients;
  const error = uiState.errors.clients;

  // Access repository for mutations
  const persistence = usePersistence();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCreateClient = async (data: CreateClientData) => {
    try {
      setSubmitting(true);
      const payload: any = {
        name: data.name
      };

      if (data.description) {
        payload.description = data.description;
      }

      await persistence.clients.create(payload);
      setCreateModalOpen(false);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "createClientFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditClient = async (data: CreateClientData) => {
    if (!selectedClient) return;

    try {
      setSubmitting(true);
      const payload: any = {
        name: data.name
      };

      if (data.description) {
        payload.description = data.description;
      }

      await persistence.clients.update(selectedClient.id, payload);
      setEditModalOpen(false);
      setSelectedClient(null);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "updateClientFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteClient = async () => {
    if (!selectedClient) return;

    try {
      setSubmitting(true);
      await persistence.clients.delete(selectedClient.id);
      setDeleteDialogOpen(false);
      setSelectedClient(null);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "deleteClientFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (client: Client) => {
    setSelectedClient(client);
    setEditModalOpen(true);
  };

  const openDeleteDialog = (client: Client) => {
    setSelectedClient(client);
    setDeleteDialogOpen(true);
  };

  useEffect(() => {
    void persistence.clients.getAll();
  }, [persistence]);

  if (loading) {
    return <PageHeaderSkeleton />;
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 lg:mb-8">
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight mb-4">
            Client Management
          </h1>
          <p className="text-sm lg:text-base text-gray-600">
            Manage your organization's clients and their information
          </p>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6">
            <ErrorState
              title="Error Loading Clients"
              message={error}
              retryText="Retry"
            />
          </div>
        )}

        {/* Client Table */}
        {clients && (
          <ClientTable
            clients={clients}
            loading={loading}
            onEdit={openEditModal}
            onDelete={openDeleteDialog}
            onCreate={() => setCreateModalOpen(true)}
          />
        )}

        {/* Create Modal */}
        <FormModal
          open={createModalOpen}
          onOpenChange={setCreateModalOpen}
          title="Create New Client"
          description="Add a new client to your organization"
        >
          <ClientForm
            onSubmit={handleCreateClient}
            onCancel={() => setCreateModalOpen(false)}
            isSubmitting={submitting}
          />
        </FormModal>

        {/* Edit Modal */}
        <FormModal
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          title="Edit Client"
          description="Update client information"
        >
          {selectedClient && (
            <ClientForm
              initialData={{
                name: selectedClient.name,
                description: selectedClient.description ?? undefined
              }}
              onSubmit={handleEditClient}
              onCancel={() => {
                setEditModalOpen(false);
                setSelectedClient(null);
              }}
              isSubmitting={submitting}
            />
          )}
        </FormModal>

        {/* Delete Confirmation Dialog */}
        <ConfirmationDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          title="Delete Client"
          description={`Are you sure you want to delete "${selectedClient?.name}"? This action cannot be undone.`}
          onConfirm={handleDeleteClient}
          isLoading={submitting}
          isDestructive
        />
      </div>
    </div>
  );
}
