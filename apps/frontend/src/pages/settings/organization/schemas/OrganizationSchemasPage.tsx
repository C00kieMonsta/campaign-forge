import { useCallback, useEffect, useState } from "react";
import {
  PersistenceServiceProvider,
  useExtractionSchemas,
  usePersistence
} from "@packages/core-client";
import type {
  NormalizedExtractionSchema,
  SchemaProperty
} from "@packages/types";
import { useToast } from "@packages/ui";
import { useNavigate } from "react-router-dom";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { ConfirmationDialog, ErrorState, FormModal } from "@/components/common";
import { OrganizationTabs } from "@/components/organization";
import {
  SchemaTable,
  SchemaVersionHistory
} from "@/components/organization/schemas";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { apiPost } from "@/lib/api";

/**
 * Organization Schemas Settings Page
 *
 * Manage extraction schemas for the organization (admin only)
 */
export default function OrganizationSchemasPage() {
  useProtectedRoute(); // Ensure user is authenticated

  const navigate = useNavigate();
  const persistence: PersistenceServiceProvider = usePersistence();
  const { toast } = useToast();

  // Read schemas from Redux store
  const schemaEntities = useExtractionSchemas();
  const [schemas, setSchemas] = useState<NormalizedExtractionSchema[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [versionHistoryModalOpen, setVersionHistoryModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedSchema, setSelectedSchema] =
    useState<NormalizedExtractionSchema | null>(null);
  const [schemaVersions, setSchemaVersions] = useState<
    NormalizedExtractionSchema[]
  >([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [schemaJobCount, setSchemaJobCount] = useState<number>(0);
  const [loadingJobCount, setLoadingJobCount] = useState(false);

  /**
   * Normalize schema data from API/Redux store
   */
  const normalizeSchema = (schema: unknown): NormalizedExtractionSchema => {
    const schemaObj = schema as Record<string, unknown> | undefined;
    if (!schemaObj) {
      throw new Error("Invalid schema object");
    }

    const definition =
      schemaObj.definition &&
      typeof schemaObj.definition === "object" &&
      !Array.isArray(schemaObj.definition)
        ? (schemaObj.definition as Record<string, unknown>)
        : {};

    const compiledJsonSchema =
      schemaObj.compiledJsonSchema &&
      typeof schemaObj.compiledJsonSchema === "object" &&
      !Array.isArray(schemaObj.compiledJsonSchema)
        ? (schemaObj.compiledJsonSchema as Record<string, unknown>)
        : {};

    const examples =
      Array.isArray(schemaObj.examples) &&
      schemaObj.examples.every(
        (example: unknown) => typeof example === "object"
      )
        ? (schemaObj.examples as Record<string, unknown>[])
        : null;

    const createdAtValue = schemaObj.createdAt;
    const createdAt =
      createdAtValue instanceof Date
        ? createdAtValue.toISOString()
        : typeof createdAtValue === "string"
          ? createdAtValue
          : new Date(
              createdAtValue ? Number(createdAtValue) : Date.now()
            ).toISOString();

    return {
      ...(schemaObj as NormalizedExtractionSchema),
      definition,
      compiledJsonSchema,
      examples,
      createdAt
    };
  };

  /**
   * Fetch schemas from repository
   */
  const fetchSchemas = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Fetch via repository - automatically hydrates Redux store
      await persistence.extractionSchemas.getAllSchemas();
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to load schemas";
      setError(errorMsg);
      console.error(
        JSON.stringify({
          level: "error",
          action: "fetchSchemas",
          error: errorMsg
        })
      );
    } finally {
      setLoading(false);
    }
  }, [persistence]);

  // Update local schemas when Redux store changes
  useEffect(() => {
    setSchemas(schemaEntities.map(normalizeSchema));
  }, [schemaEntities]);

  /**
   * Handle schema deletion
   */
  const handleDeleteSchema = async () => {
    if (!selectedSchema) return;

    try {
      setSubmitting(true);
      const { deletedJobsCount } =
        await persistence.extractionSchemas.deleteSchema(selectedSchema.id);

      // Redux store is updated automatically by repository
      setDeleteDialogOpen(false);
      setSelectedSchema(null);

      const jobsMessage =
        deletedJobsCount > 0
          ? ` ${deletedJobsCount} extraction job${deletedJobsCount !== 1 ? "s were" : " was"} also deleted.`
          : "";

      toast({
        title: "Schema deleted",
        description: `All versions of the extraction schema have been deleted successfully.${jobsMessage}`
      });
    } catch (err) {
      toast({
        title: "Error",
        description:
          err instanceof Error
            ? err.message
            : "Failed to delete schema. Please try again.",
        variant: "destructive"
      });
      console.error(
        JSON.stringify({
          level: "error",
          action: "deleteSchema",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Navigate to schema edit page
   */
  const openEditModal = (schema: NormalizedExtractionSchema) => {
    navigate(`/settings/organization/schemas/${schema.id}/edit`);
  };

  /**
   * Navigate to schema view page
   */
  const openTestModal = (schema: NormalizedExtractionSchema) => {
    navigate(`/settings/organization/schemas/${schema.id}/view`);
  };

  /**
   * Open delete confirmation dialog with job count
   */
  const openDeleteDialog = async (schema: NormalizedExtractionSchema) => {
    setSelectedSchema(schema);
    setLoadingJobCount(true);
    setDeleteDialogOpen(true);

    try {
      // Fetch the count of jobs that will be deleted across all versions
      const count = await persistence.extractionSchemas.getSchemaJobCount(
        schema.schemaIdentifier
      );
      setSchemaJobCount(count);
    } catch {
      setSchemaJobCount(0);
    } finally {
      setLoadingJobCount(false);
    }
  };

  /**
   * Open version history modal and load versions
   */
  const openVersionHistory = async (schema: NormalizedExtractionSchema) => {
    try {
      setSelectedSchema(schema);
      setLoadingVersions(true);
      setVersionHistoryModalOpen(true);

      const versions = await persistence.extractionSchemas.getSchemaVersions(
        schema.schemaIdentifier
      );

      setSchemaVersions(versions.map(normalizeSchema));
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to load version history. Please try again.",
        variant: "destructive"
      });
      console.error(
        JSON.stringify({
          level: "error",
          action: "loadVersionHistory",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
      setVersionHistoryModalOpen(false);
    } finally {
      setLoadingVersions(false);
    }
  };

  /**
   * Navigate to view a specific schema version
   */
  const handleViewVersion = (version: NormalizedExtractionSchema) => {
    setVersionHistoryModalOpen(false);
    navigate(`/settings/organization/schemas/${version.id}/view`);
  };

  /**
   * Restore a previous schema version
   */
  const handleRestoreVersion = async (version: NormalizedExtractionSchema) => {
    try {
      setSubmitting(true);

      await persistence.extractionSchemas.restoreSchemaVersion(version.id, {
        name: version.name,
        definition: version.definition,
        prompt: version.prompt || null,
        examples: version.examples || null,
        agents: version.agents || null,
        changeDescription: `Restored from v${version.version}`
      });

      // Fetch updated schemas to reflect the new version
      await fetchSchemas();
      setVersionHistoryModalOpen(false);
      toast({
        title: "Version restored",
        description: `Created new version based on v${version.version}`
      });
    } catch (err) {
      toast({
        title: "Error",
        description:
          err instanceof Error
            ? err.message
            : "Failed to restore version. Please try again.",
        variant: "destructive"
      });
      console.error(
        JSON.stringify({
          level: "error",
          action: "restoreSchemaVersion",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Navigate to create schema manually
   */
  const handleCreateManual = () => {
    navigate("/settings/organization/schemas/new");
  };

  /**
   * Navigate to create schema with AI data
   */
  const handleGenerateWithAI = (data: {
    properties: SchemaProperty[];
    prompt: string;
    examples: Record<string, unknown>[];
  }) => {
    // Encode AI data as base64 to pass via URL (Unicode-safe)
    const aiDataEncoded = btoa(encodeURIComponent(JSON.stringify(data)));
    navigate(`/settings/organization/schemas/new?aiData=${aiDataEncoded}`);
    toast({
      title: "Complete schema generated",
      description: `Generated ${data.properties.length} properties, extraction instructions, and ${data.examples.length} example(s). Review and customize as needed.`
    });
  };

  /**
   * Duplicate an existing schema
   */
  const handleDuplicateSchema = async (schema: NormalizedExtractionSchema) => {
    try {
      setSubmitting(true);

      // Generate a unique name for the duplicate
      let newName = `${schema.name} (Copy)`;
      let counter = 1;
      const existingNames = new Set(schemas.map((s) => s.name));

      while (existingNames.has(newName)) {
        counter++;
        newName = `${schema.name} (Copy ${counter})`;
      }

      // Build payload with only defined fields (avoid null values for Zod validation)
      const payload: Record<string, unknown> = {
        name: newName,
        version: 1,
        definition: schema.definition
      };

      if (schema.prompt) {
        payload.prompt = schema.prompt;
      }
      if (schema.examples && schema.examples.length > 0) {
        payload.examples = schema.examples;
      }
      if (schema.agents && schema.agents.length > 0) {
        payload.agents = schema.agents;
      }

      await apiPost("/extraction/schemas", payload);

      // Refresh schemas from store
      await fetchSchemas();
      toast({
        title: "Schema duplicated",
        description: "A new copy of the schema has been created successfully."
      });
    } catch (err) {
      toast({
        title: "Error",
        description:
          err instanceof Error
            ? err.message
            : "Failed to duplicate schema. Please try again.",
        variant: "destructive"
      });
      console.error(
        JSON.stringify({
          level: "error",
          action: "duplicateSchema",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Load schemas on mount
  useEffect(() => {
    fetchSchemas();
  }, [fetchSchemas]);

  return (
    <AdminRouteGuard>
      <div className="p-4 lg:p-6">
        <div className="mx-auto">
          {/* Header */}
          <div className="mb-6 lg:mb-8">
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight mb-2">
              Organization Settings
            </h1>
            <p className="text-sm lg:text-base text-muted-foreground">
              Manage extraction schemas for your organization
            </p>
          </div>

          {/* Tabs Navigation */}
          <OrganizationTabs />

          {/* Error State */}
          {error && (
            <div className="mt-6">
              <ErrorState message={error} onRetry={fetchSchemas} />
            </div>
          )}

          {/* Content */}
          <div className="mt-6">
            <SchemaTable
              schemas={schemas}
              loading={loading}
              onView={openTestModal}
              onEdit={openEditModal}
              onDelete={openDeleteDialog}
              onViewHistory={openVersionHistory}
              onDuplicate={handleDuplicateSchema}
              onCreateManual={handleCreateManual}
              onGenerateWithAI={handleGenerateWithAI}
            />
          </div>

          {/* Delete Confirmation Dialog */}
          <ConfirmationDialog
            open={deleteDialogOpen}
            onOpenChange={(open) => {
              setDeleteDialogOpen(open);
              if (!open) {
                setSchemaJobCount(0);
                setLoadingJobCount(false);
              }
            }}
            title="Delete Schema (All Versions)"
            description={
              loadingJobCount
                ? `Loading information about "${selectedSchema?.name}"...`
                : schemaJobCount > 0
                  ? `Are you sure you want to delete "${selectedSchema?.name}" and all its versions? This will also delete ${schemaJobCount} extraction job${schemaJobCount !== 1 ? "s" : ""} that reference${schemaJobCount === 1 ? "s" : ""} this schema. This action cannot be undone.`
                  : `Are you sure you want to delete "${selectedSchema?.name}" and all its versions? This action cannot be undone.`
            }
            confirmText="Delete All Versions"
            onConfirm={handleDeleteSchema}
            isLoading={submitting}
          />

          {/* Version History Modal */}
          <FormModal
            open={versionHistoryModalOpen}
            onOpenChange={setVersionHistoryModalOpen}
            title={`Version History: ${selectedSchema?.name || ""}`}
            description="View and manage all versions of this schema"
            maxWidth="4xl"
          >
            <SchemaVersionHistory
              versions={schemaVersions}
              currentVersionId={selectedSchema?.id || ""}
              loading={loadingVersions}
              onViewVersion={handleViewVersion}
              onRestoreVersion={handleRestoreVersion}
            />
          </FormModal>
        </div>
      </div>
    </AdminRouteGuard>
  );
}
