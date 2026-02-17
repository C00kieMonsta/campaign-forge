import { useCallback, useEffect, useState } from "react";
import type { JsonSchemaDefinition } from "@packages/types";
import { AgentDefinitionSchema } from "@packages/types";
import { useToast } from "@packages/ui";
import {
  jsonSchemaToSchemaProperties,
  schemaPropertiesToJsonSchema
} from "@packages/utils";
import { useNavigate, useParams } from "react-router-dom";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { ErrorState, LoadingSkeleton } from "@/components/common";
import {
  SchemaFormAdvanced,
  type ExtractionSchema,
  type SchemaFormData
} from "@/components/organization/schemas";
import { apiGet, apiPost } from "@/lib/api";

/**
 * Edit Extraction Schema Page
 *
 * Create a new version of an existing schema
 */
export default function EditSchemaPage() {
  const navigate = useNavigate();
  const { schemaId } = useParams<{ schemaId: string }>();
  const { toast } = useToast();

  const [schema, setSchema] = useState<ExtractionSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Fetch the schema details
   */
  const fetchSchema = useCallback(async () => {
    if (!schemaId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await apiGet(`/extraction/schemas/${schemaId}`);

      if (!response.ok) {
        throw new Error("Failed to fetch schema");
      }

      const data = await response.json();
      setSchema(data);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to load schema";
      setError(errorMsg);
      console.error(
        JSON.stringify({
          level: "error",
          action: "fetchSchema",
          schemaId,
          error: errorMsg
        })
      );
    } finally {
      setLoading(false);
    }
  }, [schemaId]);

  useEffect(() => {
    fetchSchema();
  }, [fetchSchema]);

  /**
   * Handle schema update (creates a new version)
   */
  const handleUpdateSchema = async (data: SchemaFormData) => {
    if (!schema) return;

    try {
      setSubmitting(true);
      const definition = schemaPropertiesToJsonSchema(data.properties);

      const response = await apiPost(
        `/extraction/schemas/${schema.id}/versions`,
        {
          name: data.name,
          definition,
          prompt: data.prompt || null,
          examples:
            data.examples && data.examples.length > 0 ? data.examples : null,
          agents: data.agents && data.agents.length > 0 ? data.agents : null,
          changeDescription: data.changeDescription || null
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create new version");
      }

      toast({
        title: "New version created",
        description:
          "A new version of the schema has been created successfully."
      });

      navigate("/settings/organization/schemas");
    } catch (err) {
      toast({
        title: "Error",
        description:
          err instanceof Error
            ? err.message
            : "Failed to create new version. Please try again.",
        variant: "destructive"
      });
      console.error(
        JSON.stringify({
          level: "error",
          action: "updateSchema",
          schemaId: schema.id,
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AdminRouteGuard>
        <div className="p-4 lg:p-6">
          <div className="mx-auto">
            <LoadingSkeleton />
          </div>
        </div>
      </AdminRouteGuard>
    );
  }

  if (error || !schema) {
    return (
      <AdminRouteGuard>
        <div className="p-4 lg:p-6">
          <div className="mx-auto">
            <ErrorState
              message={error || "Schema not found"}
              onRetry={fetchSchema}
            />
          </div>
        </div>
      </AdminRouteGuard>
    );
  }

  // Convert schema to form data
  const properties = jsonSchemaToSchemaProperties(
    schema.definition as unknown as JsonSchemaDefinition
  );

  const agentsResult = AgentDefinitionSchema.array().safeParse(
    schema.agents ?? []
  );
  const agents = agentsResult.success ? agentsResult.data : [];

  if (!agentsResult.success && schema.agents) {
    console.warn(
      JSON.stringify({
        level: "warn",
        action: "parseAgentsFailed",
        error: String(agentsResult.error)
      })
    );
  }

  const initialData: Partial<SchemaFormData> = {
    name: schema.name,
    version: schema.version,
    properties,
    prompt: schema.prompt || "",
    examples: schema.examples || [],
    agents,
    changeDescription: ""
  };

  return (
    <AdminRouteGuard>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="border-b border-border bg-card">
          <div className="mx-auto px-4 lg:px-6 py-6">
            <button
              onClick={() => navigate("/settings/organization/schemas")}
              className="mb-4 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <span>←</span> Back to Schemas
            </button>
            <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">
              Edit Schema: {schema.name}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Update extraction schema configuration (creates a new version)
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div className="mx-auto px-4 lg:px-6 py-8">
          <SchemaFormAdvanced
            initialData={initialData}
            onSubmit={handleUpdateSchema}
            onCancel={() => navigate("/settings/organization/schemas")}
            submitText="Update Schema"
            isSubmitting={submitting}
          />
        </div>
      </div>
    </AdminRouteGuard>
  );
}
