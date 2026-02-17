import { useEffect, useState } from "react";
import { usePersistence, useSuppliers } from "@packages/core-client";
import type {
  CreateSupplierRequest,
  Supplier,
  UpdateSupplierRequest
} from "@packages/types";
import {
  ConfirmationDialog,
  ErrorBoundary,
  ErrorState,
  FormModal,
  PageHeaderSkeleton
} from "@/components/common";
import { ImportSuppliersDialog } from "@/components/suppliers/ImportSuppliersDialog";
import { SupplierForm } from "@/components/suppliers/SupplierForm";
import { SupplierTable } from "@/components/suppliers/SupplierTable";
import { useProtectedRoute } from "@/hooks/use-protected-route";

/**
 * Suppliers Settings Page
 *
 * Manage all organization suppliers
 */
function SuppliersSettingsPageContent() {
  useProtectedRoute(); // Ensure user is authenticated

  const persistence = usePersistence();
  const suppliers = useSuppliers();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string } | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(
    null
  );

  // Fetch suppliers on mount
  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        setIsLoading(true);
        setError(null);
        await persistence.suppliers.getSuppliers();
      } catch (err) {
        setError({
          message:
            err instanceof Error ? err.message : "Failed to load suppliers"
        });
        console.error(
          JSON.stringify({
            level: "error",
            action: "fetchSuppliersFailed",
            error: err instanceof Error ? err.message : "Unknown error"
          })
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchSuppliers();
  }, [persistence]);

  const [createMutation, setCreateMutation] = useState({ isPending: false });
  const [updateMutation, setUpdateMutation] = useState({ isPending: false });
  const [deleteMutation, setDeleteMutation] = useState({ isPending: false });

  const handleCreateSupplier = async (
    formData: CreateSupplierRequest | UpdateSupplierRequest
  ) => {
    try {
      setCreateMutation({ isPending: true });
      await persistence.suppliers.createSupplier(
        formData as CreateSupplierRequest
      );
      setCreateModalOpen(false);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "createSupplierFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setCreateMutation({ isPending: false });
    }
  };

  const handleEditSupplier = async (
    formData: CreateSupplierRequest | UpdateSupplierRequest
  ) => {
    if (!selectedSupplier) return;

    try {
      setUpdateMutation({ isPending: true });
      await persistence.suppliers.updateSupplier(
        selectedSupplier.id,
        formData as UpdateSupplierRequest
      );
      setEditModalOpen(false);
      setSelectedSupplier(null);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "updateSupplierFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setUpdateMutation({ isPending: false });
    }
  };

  const handleDeleteSupplier = async () => {
    if (!selectedSupplier) return;

    try {
      setDeleteMutation({ isPending: true });
      await persistence.suppliers.deleteSupplier(selectedSupplier.id);
      setDeleteDialogOpen(false);
      setSelectedSupplier(null);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "deleteSupplierFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setDeleteMutation({ isPending: false });
    }
  };

  const openEditModal = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setEditModalOpen(true);
  };

  const openDeleteDialog = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setDeleteDialogOpen(true);
  };

  const handleExportSuppliers = () => {
    if (!suppliers || suppliers.length === 0) return;

    const headers = [
      "Name",
      "Contact Name",
      "Contact Email",
      "Contact Phone",
      "Materials Offered",
      "Created At"
    ];

    const csvRows = [
      headers.join(","),
      ...suppliers.map((supplier) => {
        const materials = Array.isArray(supplier.materialsOffered)
          ? supplier.materialsOffered.join("; ")
          : "";
        const createdAt = supplier.createdAt
          ? new Date(supplier.createdAt).toLocaleDateString()
          : "";

        return [
          `"${supplier.name}"`,
          `"${supplier.contactName || ""}"`,
          `"${supplier.contactEmail}"`,
          `"${supplier.contactPhone || ""}"`,
          `"${materials}"`,
          `"${createdAt}"`
        ].join(",");
      })
    ];

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `suppliers-${new Date().toISOString().split("T")[0]}.csv`
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(
      JSON.stringify({
        level: "info",
        action: "exportSuppliersToCSV",
        count: suppliers.length
      })
    );
  };

  if (isLoading) {
    return <PageHeaderSkeleton />;
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 lg:mb-8">
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight mb-4">
            Supplier Management
          </h1>
          <p className="text-sm lg:text-base text-gray-600">
            Manage your organization's suppliers and their information
          </p>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6">
            <ErrorState
              title="Error Loading Suppliers"
              message={error.message}
              retryText="Retry"
            />
          </div>
        )}

        {/* Supplier Table */}
        {suppliers && (
          <SupplierTable
            suppliers={suppliers}
            loading={isLoading}
            onEdit={openEditModal}
            onDelete={openDeleteDialog}
            onCreate={() => setCreateModalOpen(true)}
            onImport={() => setImportDialogOpen(true)}
            onExport={handleExportSuppliers}
          />
        )}

        {/* Create Modal */}
        <FormModal
          open={createModalOpen}
          onOpenChange={setCreateModalOpen}
          title="Create New Supplier"
          description="Add a new supplier to your organization"
        >
          <SupplierForm
            onSubmit={handleCreateSupplier}
            onCancel={() => setCreateModalOpen(false)}
            isSubmitting={createMutation.isPending}
            submitText="Create Supplier"
          />
        </FormModal>

        {/* Edit Modal */}
        <FormModal
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          title="Edit Supplier"
          description="Update supplier information"
        >
          {selectedSupplier && (
            <SupplierForm
              initialData={{
                name: selectedSupplier.name,
                contactName: selectedSupplier.contactName ?? undefined,
                contactEmail: selectedSupplier.contactEmail,
                contactPhone: selectedSupplier.contactPhone ?? undefined,
                materialsOffered: Array.isArray(
                  selectedSupplier.materialsOffered
                )
                  ? selectedSupplier.materialsOffered.join(", ")
                  : undefined
              }}
              onSubmit={handleEditSupplier}
              onCancel={() => setEditModalOpen(false)}
              isSubmitting={updateMutation.isPending}
              submitText="Save Changes"
            />
          )}
        </FormModal>

        {/* Delete Confirmation Dialog */}
        <ConfirmationDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          title="Delete Supplier"
          description={`Are you sure you want to delete "${selectedSupplier?.name}"? This action cannot be undone.`}
          onConfirm={handleDeleteSupplier}
          isLoading={deleteMutation.isPending}
          isDestructive
        />

        {/* Import Dialog */}
        <ImportSuppliersDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          onImportComplete={() => {
            // Refresh suppliers list
            persistence.suppliers.getSuppliers();
          }}
        />
      </div>
    </div>
  );
}

export default function SuppliersSettingsPage() {
  return (
    <ErrorBoundary>
      <SuppliersSettingsPageContent />
    </ErrorBoundary>
  );
}
