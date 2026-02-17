"use client";

import { useState } from "react";
import {
  useCollection,
  useEntity,
  usePersistence,
  useUIState
} from "@packages/core-client";
import { RESOURCE_STATUSES, type Project } from "@packages/types";
import { Button, Card, CardContent, Checkbox } from "@packages/ui";
import {
  Archive,
  Building2,
  Calendar,
  Check,
  Edit3,
  Grid3X3,
  RotateCcw,
  Trash2
} from "lucide-react";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageHeaderSkeleton,
  ViewModeToggle
} from "@/components/common";
import { ClientStatus } from "@/components/projects/ClientStatus";
import { CreateProjectModal } from "@/components/projects/CreateProjectModal";
import { ProjectsGrid } from "@/components/projects/ProjectsGrid";
import { ProjectsGridSelectable } from "@/components/projects/ProjectsGridSelectable";
import { ProjectsTimeline } from "@/components/projects/ProjectsTimeline";

export default function ProjectsPage() {
  const persistence = usePersistence();

  // Read from store - UI state for selections and loading
  const uiState = useUIState();
  const selectedClientId = uiState.selections.selectedClientId;
  const loading = uiState.loading.projects;
  const error = uiState.errors.projects;

  // Read from store - get selected client
  const selectedClient = useEntity("clients", selectedClientId);
  const allProjects =
    useCollection(
      "projects",
      (project: Project) => project.clientId === selectedClientId
    ) || [];

  const [viewMode, setViewMode] = useState<"grid" | "timeline">("timeline");
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(
    new Set()
  );
  const [archivingLoading, setArchivingLoading] = useState(false);

  // Filter projects based on edit mode
  const visibleProjects = isEditMode
    ? allProjects
    : allProjects.filter(
        (p: Project) => p.status !== RESOURCE_STATUSES.ARCHIVED
      );
  const activeProjects = allProjects.filter(
    (p: Project) => p.status !== RESOURCE_STATUSES.ARCHIVED
  );
  const archivedProjectsVisible = allProjects.filter(
    (p: Project) => p.status === RESOURCE_STATUSES.ARCHIVED
  );

  // Project mutations via repository
  const archiveProjects = async (projectIds: string[]) => {
    await persistence.projects.archiveProjects(projectIds);
  };

  const restoreProjects = async (projectIds: string[]) => {
    await persistence.projects.restoreProjects(projectIds);
  };

  const deleteProject = async (projectId: string) => {
    await persistence.projects.deleteProject(projectId);
  };

  // Selection handlers
  const handleSelectProject = (projectId: string, checked: boolean) => {
    const newSelected = new Set(selectedProjects);
    if (checked) {
      newSelected.add(projectId);
    } else {
      newSelected.delete(projectId);
    }
    setSelectedProjects(newSelected);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedProjects(new Set(visibleProjects.map((p: Project) => p.id)));
    } else {
      setSelectedProjects(new Set());
    }
  };

  // Archive operations
  const handleArchiveSelected = async () => {
    const activeSelectedIds = Array.from(selectedProjects).filter(
      (id) =>
        allProjects?.find((p: Project) => p.id === id)?.status !==
        RESOURCE_STATUSES.ARCHIVED
    );
    if (activeSelectedIds.length > 0) {
      try {
        setArchivingLoading(true);
        await archiveProjects(activeSelectedIds);
        setSelectedProjects(new Set());
      } catch {
        // Error handled by toast
      } finally {
        setArchivingLoading(false);
      }
    }
  };

  const handleRestoreSelected = async () => {
    const archivedSelectedIds = Array.from(selectedProjects).filter(
      (id) =>
        allProjects?.find((p: Project) => p.id === id)?.status ===
        RESOURCE_STATUSES.ARCHIVED
    );
    if (archivedSelectedIds.length > 0) {
      try {
        setArchivingLoading(true);
        await restoreProjects(archivedSelectedIds);
        setSelectedProjects(new Set());
      } catch {
        // Error handled by toast
      } finally {
        setArchivingLoading(false);
      }
    }
  };

  const handleDeleteSelected = async () => {
    const archivedSelectedIds = Array.from(selectedProjects).filter(
      (id) =>
        allProjects?.find((p: Project) => p.id === id)?.status ===
        RESOURCE_STATUSES.ARCHIVED
    );
    if (archivedSelectedIds.length > 0) {
      try {
        setArchivingLoading(true);
        await Promise.all(archivedSelectedIds.map((id) => deleteProject(id)));
        setSelectedProjects(new Set());
      } catch {
        // Error handled by toast
      } finally {
        setArchivingLoading(false);
      }
    }
  };

  const toggleEditMode = () => {
    setIsEditMode(!isEditMode);
    setSelectedProjects(new Set()); // Clear selections when toggling mode
  };

  // Selection counts
  const selectedActiveCount = Array.from(selectedProjects).filter(
    (id) =>
      allProjects?.find((p: Project) => p.id === id)?.status !==
      RESOURCE_STATUSES.ARCHIVED
  ).length;

  const selectedArchivedCount = Array.from(selectedProjects).filter(
    (id) =>
      allProjects?.find((p: Project) => p.id === id)?.status ===
      RESOURCE_STATUSES.ARCHIVED
  ).length;

  if (loading && !isEditMode) {
    return <PageHeaderSkeleton />;
  }

  const viewModeOptions = [
    {
      key: "timeline",
      label: "Timeline",
      icon: <Calendar className="h-4 w-4" />,
      ariaLabel: "Timeline view"
    },
    {
      key: "grid",
      label: "Grid",
      icon: <Grid3X3 className="h-4 w-4" />,
      ariaLabel: "Grid view"
    }
  ];

  const headerActions = (
    <div className="flex items-center gap-3">
      {!isEditMode && (
        <>
          <ViewModeToggle<"grid" | "timeline">
            currentMode={viewMode}
            options={viewModeOptions}
            onModeChange={setViewMode}
          />
          {selectedClientId && (
            <CreateProjectModal clientId={selectedClientId} />
          )}
        </>
      )}
      <Button
        variant={isEditMode ? "default" : "outline"}
        size="sm"
        onClick={toggleEditMode}
      >
        {isEditMode ? (
          <>
            <Check className="w-4 h-4 mr-2" />
            Done
          </>
        ) : (
          <>
            <Edit3 className="w-4 h-4 mr-2" />
            Edit
          </>
        )}
      </Button>
    </div>
  );

  return (
    <div className="max-h-[90vh] bg-background flex flex-col">
      <PageHeader
        title="Projects Dashboard"
        description="Manage your material extraction projects and track progress"
        actions={headerActions}
      >
        <ClientStatus
          client={selectedClient}
          projectCount={
            isEditMode ? allProjects?.length || 0 : activeProjects?.length || 0
          }
        />
        {isEditMode && archivedProjectsVisible.length > 0 && (
          <div className="text-sm text-muted-foreground mt-1">
            ({archivedProjectsVisible.length} archived)
          </div>
        )}
      </PageHeader>

      <main className="container mx-auto px-6 py-8 flex-1 overflow-y-auto shadow-inner bg-gradient-to-b from-background via-background to-muted/10">
        {/* Error State */}
        {error && (
          <div className="mb-6">
            <ErrorState
              title="Error Loading Projects"
              message={error}
              retryText="Retry Projects"
            />
          </div>
        )}

        {/* Edit Mode Controls */}
        {isEditMode && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Checkbox
                    checked={
                      selectedProjects.size === visibleProjects.length &&
                      visibleProjects.length > 0
                    }
                    onCheckedChange={handleSelectAll}
                  />
                  <span className="text-sm text-muted-foreground">
                    {selectedProjects.size} of {visibleProjects.length} projects
                    selected
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {selectedActiveCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleArchiveSelected}
                      disabled={archivingLoading}
                    >
                      <Archive className="w-4 h-4 mr-2" />
                      Archive ({selectedActiveCount})
                    </Button>
                  )}
                  {selectedArchivedCount > 0 && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRestoreSelected}
                        disabled={archivingLoading}
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Restore ({selectedArchivedCount})
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDeleteSelected}
                        disabled={archivingLoading}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete ({selectedArchivedCount})
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Projects Content */}
        {!selectedClientId ? (
          <EmptyState
            icon={Building2}
            title="Select a Client"
            description="Choose a client from the sidebar to view and manage their projects"
          />
        ) : !allProjects || allProjects.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No projects yet"
            description={`Get started by creating your first project for ${selectedClient?.name}`}
          >
            <CreateProjectModal clientId={selectedClientId} />
          </EmptyState>
        ) : isEditMode ? (
          <div className="space-y-6">
            {/* Active Projects */}
            {activeProjects.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Active Projects ({activeProjects.length})
                </h2>
                <ProjectsGridSelectable
                  projects={activeProjects}
                  isEditMode={isEditMode}
                  selectedProjects={selectedProjects}
                  onSelectProject={handleSelectProject}
                />
              </div>
            )}

            {/* Archived Projects */}
            {archivedProjectsVisible.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Archived Projects ({archivedProjectsVisible.length})
                </h2>
                <ProjectsGridSelectable
                  projects={archivedProjectsVisible}
                  isEditMode={isEditMode}
                  selectedProjects={selectedProjects}
                  onSelectProject={handleSelectProject}
                />
              </div>
            )}
          </div>
        ) : viewMode === "timeline" ? (
          <ProjectsTimeline projects={activeProjects} />
        ) : (
          <ProjectsGrid projects={activeProjects} />
        )}
      </main>
    </div>
  );
}
