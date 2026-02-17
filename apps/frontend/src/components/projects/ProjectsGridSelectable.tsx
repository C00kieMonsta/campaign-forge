import type { Project } from "@packages/types";
import { ProjectCard } from "./ProjectCard";
import { ProjectCardSelectable } from "./ProjectCardSelectable";

interface ProjectsGridSelectableProps {
  projects: Project[];
  isEditMode?: boolean;
  selectedProjects?: Set<string>;
  onSelectProject?: (projectId: string, checked: boolean) => void;
}

export function ProjectsGridSelectable({
  projects,
  isEditMode = false,
  selectedProjects = new Set(),
  onSelectProject
}: ProjectsGridSelectableProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
      {projects.map((project) =>
        isEditMode ? (
          <ProjectCardSelectable
            key={project.id}
            project={project}
            isEditMode={isEditMode}
            isSelected={selectedProjects.has(project.id)}
            {...(onSelectProject && { onSelect: onSelectProject })}
          />
        ) : (
          <ProjectCard key={project.id} project={project} />
        )
      )}
    </div>
  );
}
