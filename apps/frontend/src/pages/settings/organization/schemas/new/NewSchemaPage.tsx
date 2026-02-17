import { useState } from "react";
import type { SchemaProperty } from "@packages/types";
import { Button, useToast } from "@packages/ui";
import { schemaPropertiesToJsonSchema } from "@packages/utils";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import {
  SchemaFormAdvanced,
  type SchemaFormData
} from "@/components/organization/schemas";
import { apiPost } from "@/lib/api";

/**
 * Create New Extraction Schema Page
 *
 * Create a new schema manually or from AI-generated data
 */
export default function NewSchemaPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  // Check if we have AI-generated data in URL params (base64 encoded)
  const aiDataParam = searchParams.get("aiData");
  let aiGeneratedData: {
    properties: SchemaProperty[];
    prompt: string;
    examples: Record<string, unknown>[];
  } | null = null;

  if (aiDataParam) {
    try {
      aiGeneratedData = JSON.parse(decodeURIComponent(atob(aiDataParam)));
    } catch {
      // Error handled silently
    }
  }

  const handleCreateSchema = async (data: SchemaFormData) => {
    try {
      setSubmitting(true);
      const definition = schemaPropertiesToJsonSchema(data.properties);

      // Build request payload with only defined fields (Zod uses undefined, not null)
      const payload: Record<string, unknown> = {
        name: data.name,
        version: data.version,
        definition
      };

      // Only add optional fields if they have values
      if (data.prompt) {
        payload.prompt = data.prompt;
      }
      if (data.examples && data.examples.length > 0) {
        payload.examples = data.examples;
      }
      if (data.agents && data.agents.length > 0) {
        payload.agents = data.agents;
      }

      const response = await apiPost("/extraction/schemas", payload);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create schema");
      }

      toast({
        title: "Schema created",
        description: "The extraction schema has been created successfully."
      });

      navigate("/settings/organization/schemas");
    } catch (err) {
      toast({
        title: "Error",
        description:
          err instanceof Error
            ? err.message
            : "Failed to create schema. Please try again.",
        variant: "destructive"
      });
      console.error(
        JSON.stringify({
          level: "error",
          action: "createSchema",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminRouteGuard>
      <div className="p-4 lg:p-6">
        <div className="mx-auto">
          {/* Header */}
          <div className="mb-6 lg:mb-8">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/settings/organization/schemas")}
              className="mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Schemas
            </Button>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight mb-2">
              {aiGeneratedData
                ? "Review AI-Generated Schema"
                : "Create New Schema"}
            </h1>
            <p className="text-sm lg:text-base text-muted-foreground">
              {aiGeneratedData
                ? "Review and customize the AI-generated properties, prompt, and examples before creating the schema"
                : "Define a new extraction schema with properties, prompt, and examples"}
            </p>
          </div>

          {/* Form */}
          <div>
            <SchemaFormAdvanced
              {...(aiGeneratedData
                ? {
                    initialData: {
                      name: "",
                      version: 1,
                      properties: aiGeneratedData.properties,
                      prompt: aiGeneratedData.prompt,
                      examples: aiGeneratedData.examples
                    }
                  }
                : {})}
              onSubmit={handleCreateSchema}
              onCancel={() => navigate("/settings/organization/schemas")}
              submitText="Create Schema"
              isSubmitting={submitting}
            />
          </div>
        </div>
      </div>
    </AdminRouteGuard>
  );
}
