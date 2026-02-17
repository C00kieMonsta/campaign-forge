"use client";

import React, { useEffect, useState } from "react";
import {
  useEntity,
  useExtractionJobs,
  usePersistence
} from "@packages/core-client";
import {
  TABLE_NAMES,
  type DataLayer,
  type ExtractionJob,
  type JsonSchemaDefinition,
  type SchemaProperty,
  type Supplier
} from "@packages/types";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@packages/ui";
import { jsonSchemaToSchemaProperties } from "@packages/utils";
import { AlertCircle, ArrowLeft, FileText, Package } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ErrorBoundary } from "@/components/common";
import { AttachmentsTable } from "@/components/projects/AttachmentsTable";
import { EditProjectModal } from "@/components/projects/EditProjectModal";
import { ExtractionJobLogsModal } from "@/components/projects/ExtractionJobLogsModal";
import { ExtractionsTable } from "@/components/projects/ExtractionsTable";
import { FileUpload } from "@/components/projects/FileUpload";
import { PDFViewer } from "@/components/projects/PDFViewer";
import { ProjectStats } from "@/components/projects/ProjectStats";
import { SupplierCard } from "@/components/projects/SupplierCard";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

function ProjectPageContent() {
  const params = useParams();
  const projectId = params.projectId as string;

  // Read project from store using generic hook
  const project = useEntity("projects", projectId);

  // Get persistence provider for data access
  const persistence = usePersistence();

  useEffect(() => {
    if (!projectId) return;

    const fetchProjectSuppliers = async () => {
      try {
        const data = await persistence.projects.getProjectSuppliers(projectId);
        setProjectSuppliers(data.suppliers);
        setProjectStats(data.stats);
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            action: "fetchProjectSuppliers",
            error: err instanceof Error ? err.message : "Unknown error"
          })
        );
      }
    };

    fetchProjectSuppliers();
  }, [projectId, persistence]);

  useEffect(() => {
    if (!projectId) return;
    const fetchDataLayers = async () => {
      try {
        setIsLoadingDataLayers(true);
        const layers = await persistence.dataLayers.getByProject(projectId);
        setDataLayers(layers);
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            action: "fetchDataLayers",
            error: err instanceof Error ? err.message : "Unknown error"
          })
        );
      } finally {
        setIsLoadingDataLayers(false);
      }
    };
    fetchDataLayers();
  }, [projectId, persistence]);

  // Fetch extraction schemas for the schema selection dropdown
  useEffect(() => {
    const fetchSchemas = async () => {
      try {
        await persistence.extractionSchemas.getAllSchemas();
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            action: "fetchExtractionSchemas",
            error: err instanceof Error ? err.message : "Unknown error"
          })
        );
      }
    };
    void fetchSchemas();
  }, [persistence]);

  // Fetch extraction jobs for this specific project
  React.useEffect(() => {
    if (!projectId) return;

    const fetchProjectJobs = async () => {
      try {
        console.log("[ProjectPage] Fetching jobs for project:", projectId);
        // Fetch jobs for this specific project
        // The repository will hydrate the store
        const jobs =
          await persistence.extractionJobs.getExtractionJobsByProject(
            projectId
          );
        console.log("[ProjectPage] Fetched jobs:", jobs);
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            action: "fetchProjectJobs",
            error: error instanceof Error ? error.message : "Unknown error"
          })
        );
      }
    };

    fetchProjectJobs();
  }, [projectId, persistence]);

  // Get all extraction jobs from store and filter by ones that belong to this project
  const allExtractionJobs = useExtractionJobs();
  const extractionJobs = React.useMemo(() => {
    // Filter jobs by checking if any of their data layers match a project
    // The API endpoint we called (getExtractionJobsByProject) returns jobs for this project
    // But they are stored in the global store, so we still need to filter them
    return allExtractionJobs
      .filter((job: ExtractionJob) => {
        // Check if job has extractionJobDataLayers with dataLayer info
        // Note: extractionJobDataLayers is an optional relation that may be included by the backend
        const jobDataLayers = (
          job as ExtractionJob & { extractionJobDataLayers?: unknown[] }
        ).extractionJobDataLayers;
        if (!jobDataLayers || !Array.isArray(jobDataLayers)) {
          return false;
        }

        // Since we fetched via getExtractionJobsByProject(projectId),
        // all returned jobs should have at least one data layer for this project
        // But we'll be safe and verify one exists
        return jobDataLayers.length > 0;
      })
      .sort(
        (a: ExtractionJob, b: ExtractionJob) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }, [allExtractionJobs]);

  // Fetch project data layers
  const [dataLayers, setDataLayers] = useState<DataLayer[]>([]);
  const [isLoadingDataLayers, setIsLoadingDataLayers] = useState(false);

  // Get client name from project or from store (MOVED UP - before conditional return)
  const client = useEntity("clients", project?.clientId || null);
  const clientName = client?.name || "Unknown";

  // State for PDF viewer
  const [selectedFile, setSelectedFile] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [isPDFViewerOpen, setIsPDFViewerOpen] = useState(false);

  // State for expanded jobs and files
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());
  const [expandedZipIds, setExpandedZipIds] = useState<Set<string>>(new Set());
  const [deletingFileIds, setDeletingFileIds] = useState<Set<string>>(
    new Set()
  );
  const [deletedFileIds, setDeletedFileIds] = useState<Set<string>>(new Set());

  // State for file upload modal
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // State for logs modal
  const [selectedJobForLogs, setSelectedJobForLogs] =
    useState<ExtractionJob | null>(null);
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);

  // State for edit project modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // State for active tab
  const [activeTab, setActiveTab] = useState("suppliers");

  // Create a stable reference for file IDs
  const dataLayerIds = React.useMemo(
    () =>
      dataLayers
        .map((dl: DataLayer) => dl.id)
        .sort()
        .join(","),
    [dataLayers]
  );

  // Clear optimistic state when data is successfully refetched
  React.useEffect(() => {
    if (dataLayers.length > 0 && deletedFileIds.size > 0) {
      const currentFileIds = new Set(dataLayers.map((dl: DataLayer) => dl.id));
      const newDeletedFiles = new Set<string>();

      for (const fileId of deletedFileIds) {
        if (currentFileIds.has(fileId)) {
          newDeletedFiles.add(fileId);
        }
      }

      if (newDeletedFiles.size !== deletedFileIds.size) {
        setDeletedFileIds(newDeletedFiles);
      }
    }
  }, [dataLayerIds, deletedFileIds]);

  const schemaPropertiesByJob = React.useMemo(() => {
    const map: Record<string, SchemaProperty[]> = {};

    extractionJobs.forEach((job) => {
      const schemaDef = job?.compiledJsonSchema;
      if (
        !schemaDef ||
        typeof schemaDef !== "object" ||
        Array.isArray(schemaDef)
      ) {
        return;
      }

      try {
        map[job.id] = jsonSchemaToSchemaProperties(
          schemaDef as JsonSchemaDefinition
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            action: "jsonSchemaConversion",
            error: error instanceof Error ? error.message : "Unknown error"
          })
        );
      }
    });

    return map;
  }, [extractionJobs]);

  // Helper to get auth headers for file operations
  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    try {
      const supabase = getSupabaseBrowser();
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      return token
        ? {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        : { "Content-Type": "application/json" };
    } catch {
      return { "Content-Type": "application/json" };
    }
  };

  // Handlers - Note: These file operations use direct fetch as they're not part of the core persistence layer
  const handleViewFile = async (dataLayer: DataLayer) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/api/${TABLE_NAMES.DATA_LAYERS}/${dataLayer.id}/download-url`,
        { headers }
      );
      const data = await response.json();
      if (data?.downloadUrl) {
        setSelectedFile({ url: data.downloadUrl, name: dataLayer.name });
        setIsPDFViewerOpen(true);
      } else {
        alert("Failed to load file. Please try again.");
      }
    } catch {
      alert("Failed to load file. Please try again.");
    }
  };

  const handleDownloadFile = async (dataLayer: DataLayer) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/api/${TABLE_NAMES.DATA_LAYERS}/${dataLayer.id}/download-url`,
        { headers }
      );
      const data = await response.json();
      if (data?.downloadUrl) {
        const link = document.createElement("a");
        link.href = data.downloadUrl;
        link.download = dataLayer.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        alert("Failed to download file. Please try again.");
      }
    } catch {
      alert("Failed to download file. Please try again.");
    }
  };

  const handleDeleteFile = async (dataLayer: DataLayer) => {
    if (!confirm(`Are you sure you want to delete "${dataLayer.name}"?`)) {
      return;
    }

    setDeletedFileIds((prev) => new Set(prev).add(dataLayer.id));
    setDeletingFileIds((prev) => new Set(prev).add(dataLayer.id));

    try {
      const headers = await getAuthHeaders();
      await fetch(
        `${import.meta.env.VITE_API_URL}/api/${TABLE_NAMES.DATA_LAYERS}/${dataLayer.id}`,
        {
          method: "DELETE",
          headers
        }
      );
      console.log(
        JSON.stringify({
          level: "info",
          action: "fileDeleted",
          fileName: dataLayer.name
        })
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "fileDeleteFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
      setDeletedFileIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(dataLayer.id);
        return newSet;
      });
      alert(`Failed to delete ${dataLayer.name}. Please try again.`);
    } finally {
      setDeletingFileIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(dataLayer.id);
        return newSet;
      });
    }
  };

  const handleToggleJobExpansion = (jobId: string) => {
    setExpandedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const handleToggleZipExpansion = (zipId: string) => {
    setExpandedZipIds((prev) => {
      const next = new Set(prev);
      if (next.has(zipId)) {
        next.delete(zipId);
      } else {
        next.add(zipId);
      }
      return next;
    });
  };

  const handleViewResults = (job: ExtractionJob) => {
    window.location.href = `/extraction?jobId=${job.id}&jobName=${encodeURIComponent(job.id.slice(0, 8))}&projectId=${projectId}`;
  };

  const handleViewLogs = (job: ExtractionJob) => {
    setSelectedJobForLogs(job);
    setIsLogsModalOpen(true);
  };

  const handleUploadComplete = () => {
    setIsUploadModalOpen(false);
    window.location.reload();
  };

  const handleSwitchToAttachments = () => {
    setActiveTab("attachments");
  };

  // State for project suppliers (with matches)
  const [projectSuppliers, setProjectSuppliers] = useState<
    Array<{
      supplier: Supplier;
      matchedItems: number;
      totalProjectItems: number;
      matchPercentage: number;
      extractionResults: Array<{
        id: string;
        data: Record<string, unknown>;
        jobId: string;
      }>;
    }>
  >([]);
  const [projectStats, setProjectStats] = useState({
    totalItems: 0,
    matchedItems: 0,
    unmatchedItems: 0,
    suppliersFound: 0
  });

  // Update suppliers and stats when fetching project suppliers
  useEffect(() => {
    if (!projectId) return;

    const fetchProjectSuppliers = async () => {
      try {
        const data = await persistence.projects.getProjectSuppliers(projectId);

        // Use full enriched response with stats and match percentages
        setProjectSuppliers(data.suppliers);
        setProjectStats(data.stats);
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            action: "fetchProjectSuppliers",
            error: err instanceof Error ? err.message : "Unknown error"
          })
        );
      }
    };

    fetchProjectSuppliers();
  }, [projectId, persistence]);

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto px-4 py-8 sm:px-6 lg:px-8">
          <Card className="p-12">
            <div className="flex flex-col items-center justify-center text-center">
              <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Project Not Found</h3>
              <p className="text-sm text-muted-foreground max-w-md mb-4">
                The project you are looking for does not exist or you do not
                have access to it.
              </p>
              <Link to="/projects">
                <Button>Back to Projects</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // Use fetched project stats
  const stats = projectStats;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/projects">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  {project.name}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setIsEditModalOpen(true)}>
                <span className="text-sm font-medium">Edit</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
            {project.name}
          </h1>
          {project.description && (
            <p className="text-muted-foreground mb-4">{project.description}</p>
          )}
          <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg w-fit">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Client: {clientName}
            </span>
          </div>
        </div>

        <ProjectStats stats={stats} />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-8">
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <TabsTrigger value="suppliers">
              Suppliers ({stats.suppliersFound})
            </TabsTrigger>
            <TabsTrigger value="attachments">
              Attachments ({dataLayers.length})
            </TabsTrigger>
            <TabsTrigger value="jobs">
              Jobs ({extractionJobs.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="suppliers" className="mt-6">
            {projectSuppliers.length > 0 ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Showing {projectSuppliers.length} suppliers matched across
                    all extraction jobs
                  </p>
                </div>
                {projectSuppliers.map((supplierData) => (
                  <SupplierCard
                    key={supplierData.supplier.id}
                    supplier={supplierData.supplier}
                    matchedItems={supplierData.matchedItems}
                    totalProjectItems={supplierData.totalProjectItems}
                    matchPercentage={supplierData.matchPercentage}
                    extractionResults={
                      supplierData.extractionResults as Array<{
                        id: string;
                        data: Record<string, unknown>;
                        jobId: string;
                      }>
                    }
                    projectId={projectId}
                    schemaPropertiesByJob={schemaPropertiesByJob}
                  />
                ))}
              </div>
            ) : (
              <Card className="p-12">
                <div className="flex flex-col items-center justify-center text-center">
                  <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    No Suppliers Found
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    No suppliers could be matched to the extracted items. Try
                    uploading additional documents or check extraction job
                    results.
                  </p>
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="attachments" className="mt-6">
            <AttachmentsTable
              dataLayers={dataLayers}
              loading={isLoadingDataLayers}
              deletingFiles={deletingFileIds}
              deletedFiles={deletedFileIds}
              expandedZips={expandedZipIds}
              onToggleZipExpansion={handleToggleZipExpansion}
              onUpload={() => setIsUploadModalOpen(true)}
              onView={handleViewFile}
              onDownload={handleDownloadFile}
              onDelete={handleDeleteFile}
            />
          </TabsContent>

          <TabsContent value="jobs" className="mt-6">
            <ExtractionsTable
              dataLayers={dataLayers}
              expandedJobs={expandedJobIds}
              onToggleJobExpansion={handleToggleJobExpansion}
              onViewResults={handleViewResults}
              onViewFile={handleViewFile}
              onDownloadFile={handleDownloadFile}
              onSwitchToAttachments={handleSwitchToAttachments}
              onViewLogs={handleViewLogs}
            />
          </TabsContent>
        </Tabs>
      </main>

      {selectedFile && (
        <PDFViewer
          fileUrl={selectedFile.url}
          fileName={selectedFile.name}
          isOpen={isPDFViewerOpen}
          onClose={() => {
            setIsPDFViewerOpen(false);
            setSelectedFile(null);
          }}
        />
      )}

      <Dialog open={isUploadModalOpen} onOpenChange={setIsUploadModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Upload Files</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            <FileUpload
              projectId={projectId}
              onUploadComplete={handleUploadComplete}
            />
          </div>
        </DialogContent>
      </Dialog>

      <ExtractionJobLogsModal
        job={selectedJobForLogs}
        isOpen={isLogsModalOpen}
        onClose={() => {
          setIsLogsModalOpen(false);
          setSelectedJobForLogs(null);
        }}
      />

      {project && (
        <EditProjectModal
          project={project}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onProjectUpdated={() => {
            // Store is automatically updated by the repository
          }}
        />
      )}
    </div>
  );
}

export default function ProjectPage() {
  return (
    <ErrorBoundary>
      <ProjectPageContent />
    </ErrorBoundary>
  );
}
