import { useEffect, useState } from "react";
import type {
  JsonSchemaDefinition,
  NormalizedExtractionSchema
} from "@packages/types";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  useToast
} from "@packages/ui";
import { jsonSchemaToSchemaProperties } from "@packages/utils";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { ErrorState, LoadingSkeleton } from "@/components/common";
import {
  ExtractionRow,
  type FlexibleExtractionResult
} from "@/components/extraction";
import {
  SchemaDetails,
  TestHistory,
  type ExtractionSchema
} from "@/components/organization/schemas";
import { apiGet, apiRequest } from "@/lib/api";
import {
  getSchemaTestHistory,
  saveTestResult,
  type StoredTestResult
} from "@/lib/test-history";

/**
 * View and Test Extraction Schema Page
 *
 * View schema details and test extraction against sample files
 */

const normalizeSchema = (
  schemaData: Record<string, unknown>
): NormalizedExtractionSchema => {
  const definition =
    schemaData?.definition &&
    typeof schemaData.definition === "object" &&
    !Array.isArray(schemaData.definition)
      ? (schemaData.definition as Record<string, unknown>)
      : {};

  const compiledJsonSchema =
    schemaData?.compiledJsonSchema &&
    typeof schemaData.compiledJsonSchema === "object" &&
    !Array.isArray(schemaData.compiledJsonSchema)
      ? (schemaData.compiledJsonSchema as Record<string, unknown>)
      : {};

  const examples =
    Array.isArray(schemaData?.examples) &&
    schemaData.examples.every((example: unknown) => typeof example === "object")
      ? (schemaData.examples as Record<string, unknown>[])
      : null;

  const createdAtValue = schemaData?.createdAt;
  const createdAt =
    createdAtValue instanceof Date
      ? createdAtValue.toISOString()
      : typeof createdAtValue === "string"
        ? createdAtValue
        : new Date(
            (createdAtValue as string | number | undefined) ?? Date.now()
          ).toISOString();

  return {
    ...(schemaData as NormalizedExtractionSchema),
    definition,
    compiledJsonSchema,
    examples,
    createdAt
  };
};

export default function ViewSchemaPage() {
  const navigate = useNavigate();
  const { schemaId } = useParams<{ schemaId: string }>();
  const { toast } = useToast();

  const [schema, setSchema] = useState<ExtractionSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [testFile, setTestFile] = useState<File | null>(null);
  const [testResults, setTestResults] = useState<Array<
    Record<string, unknown>
  > | null>(null);
  const [testMeta, setTestMeta] = useState<{
    processedPages: number;
    totalPages: number;
    durationMs: number;
    schema: { id: string; name: string };
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testHistory, setTestHistory] = useState<StoredTestResult[]>([]);

  /**
   * Fetch schema details on component mount
   */
  useEffect(() => {
    const fetchSchema = async () => {
      if (!schemaId) return;

      try {
        setLoading(true);
        setError(null);
        const response = await apiGet(`/extraction/schemas/${schemaId}`);

        if (!response.ok) {
          throw new Error("Failed to fetch schema");
        }

        const data = await response.json();
        const normalized = normalizeSchema(data);
        setSchema(normalized);

        // Load test history
        const history = getSchemaTestHistory(normalized.id);
        setTestHistory(history);
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
    };

    fetchSchema();
  }, [schemaId]);

  /**
   * Estimate PDF page count from binary data
   */
  const estimatePdfPageCount = async (file: File): Promise<number> => {
    try {
      const buf = await file.arrayBuffer();
      const text = new TextDecoder().decode(new Uint8Array(buf));
      // eslint-disable-next-line no-useless-escape
      const matches = text.match(/\/Type\s*\/Page[\s\n\r>\/]/g);
      const count = matches ? matches.length : 1;
      return count;
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          action: "estimatePdfPageCount",
          error: error instanceof Error ? error.message : "Failed to estimate"
        })
      );
      return 1;
    }
  };

  /**
   * Handle file selection for testing
   */
  const handleSelectTestFile = async (f: File | null) => {
    setTestResults(null);
    setTestMeta(null);
    setTestFile(null);

    if (!f) {
      return;
    }

    const isPdf =
      f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      const pages = await estimatePdfPageCount(f);
      if (pages > 1) {
        toast({
          title: "Multi-page PDF detected",
          description: `This PDF appears to have ${pages} pages. The server will reject it if it's not exactly 1 page.`,
          variant: "default"
        });
      }
      setTestFile(f);
      return;
    }

    if (f.type.startsWith("image/")) {
      setTestFile(f);
      return;
    }

    toast({
      title: "Unsupported file",
      description: "Upload a single-page PDF or an image file.",
      variant: "destructive"
    });
  };

  /**
   * Run schema test against selected file
   */
  const runSchemaTest = async () => {
    if (!schema || !testFile) {
      return;
    }
    setTesting(true);
    setTestResults(null);
    setTestMeta(null);
    try {
      toast({ title: "Starting test", description: "Uploading file…" });
      const form = new FormData();
      form.append("file", testFile);
      const res = await apiRequest(`/extraction/schemas/${schema.id}/test`, {
        method: "POST",
        body: form
      });

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({}) as Record<string, unknown>);
        throw new Error(
          ((err as Record<string, unknown>)?.message as string) ||
            "Schema test failed"
        );
      }
      const data: {
        materials: Array<Record<string, unknown>>;
        meta: {
          processedPages: number;
          totalPages: number;
          durationMs: number;
          schema: { id: string; name: string };
        };
      } = await res.json();

      setTestResults(data.materials || []);
      setTestMeta(data.meta);

      if (schema && testFile) {
        saveTestResult(
          schema.id,
          schema.name,
          testFile.name,
          data.materials || [],
          data.meta
        );
        const updatedHistory = getSchemaTestHistory(schema.id);
        setTestHistory(updatedHistory);
      }

      toast({
        title: "Test completed",
        description: `Found ${data.materials?.length || 0} material(s) in ~${Math.round(
          data.meta.durationMs
        )}ms`
      });
    } catch (e) {
      toast({
        title: "Test failed",
        description: e instanceof Error ? e.message : "Unable to run test",
        variant: "destructive"
      });
      console.error(
        JSON.stringify({
          level: "error",
          action: "schemaTest",
          error: e instanceof Error ? e.message : "Unknown error"
        })
      );
    } finally {
      setTesting(false);
    }
  };

  /**
   * Load a test from history
   */
  const handleLoadTestHistory = (test: StoredTestResult) => {
    setTestResults(test.results);
    setTestMeta(test.meta);
    setTestFile(null);
    toast({
      title: "Test loaded",
      description: `Loaded results from ${test.fileName}`
    });
  };

  /**
   * Delete a test from history
   */
  const handleDeleteTestHistory = (testId: string) => {
    setTestHistory((prev) => prev.filter((t) => t.id !== testId));
    toast({
      title: "Test deleted",
      description: "Test result removed from history"
    });
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
              onRetry={() => window.location.reload()}
            />
          </div>
        </div>
      </AdminRouteGuard>
    );
  }

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
              View Schema: {schema.name}
            </h1>
            <p className="text-sm lg:text-base text-muted-foreground">
              Upload a single-page PDF or an image to validate the schema
              without saving any data
            </p>
          </div>

          {/* Content */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SchemaDetails schema={schema} />
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="schema-test-file">
                      Test file (1 page only)
                    </Label>
                    <Input
                      id="schema-test-file"
                      type="file"
                      accept="application/pdf,image/*"
                      multiple={false}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleSelectTestFile(e.currentTarget.files?.[0] ?? null)
                      }
                    />
                    {testFile && (
                      <p className="text-xs">
                        Selected:{" "}
                        <span className="font-medium">{testFile.name}</span>
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Only 1 page is allowed. PDFs with more than one page will
                      be rejected.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      onClick={runSchemaTest}
                      disabled={!testFile || testing}
                    >
                      {testing ? "Testing..." : "Run test"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setTestFile(null);
                        setTestResults(null);
                        setTestMeta(null);
                      }}
                      disabled={testing}
                    >
                      Reset
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <TestHistory
                history={testHistory}
                onLoadTest={handleLoadTestHistory}
                onDeleteTest={handleDeleteTestHistory}
              />

              <div>
                {!testResults && !testing && (
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">
                        No test results yet.
                      </p>
                    </CardContent>
                  </Card>
                )}
                {testing && (
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm">Running test…</p>
                    </CardContent>
                  </Card>
                )}
                {testResults && (
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground">
                      {testMeta
                        ? `Processed ${testMeta.processedPages}/${testMeta.totalPages} page(s) in ${Math.round(
                            testMeta.durationMs
                          )}ms`
                        : null}
                    </div>
                    {testResults.length === 0 ? (
                      <Card>
                        <CardContent className="pt-6">
                          <p className="text-sm text-muted-foreground">
                            No materials found.
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-4">
                        {testResults.map((result, idx) => {
                          const resultData = result as Record<string, unknown>;
                          const evidence = resultData.evidence as
                            | Record<string, unknown>
                            | undefined;
                          const rawExtraction = resultData as Record<
                            string,
                            unknown
                          >;

                          const testMaterial = {
                            id: `test-${idx}`,
                            extractionJobId: "test",
                            rawExtraction,
                            evidence: evidence || {},
                            verifiedData: null,
                            status: "pending" as const,
                            confidenceScore: rawExtraction[
                              "confidenceScore"
                            ] as number | undefined,
                            pageNumber: rawExtraction["pageNumber"] as
                              | number
                              | undefined,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            originalSnippet: String(
                              evidence?.sourceText || "No snippet available"
                            )
                          };

                          return (
                            <ExtractionRow
                              key={idx}
                              material={
                                testMaterial as FlexibleExtractionResult
                              }
                              schema={jsonSchemaToSchemaProperties(
                                schema.definition as unknown as JsonSchemaDefinition
                              )}
                              readOnly={true}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminRouteGuard>
  );
}
