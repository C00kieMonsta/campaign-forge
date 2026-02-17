import { useCollection } from "@packages/core-client";
import type { Project } from "@packages/types";

/**
 * useProjects
 *
 * Get all projects for the current organization from Redux store
 * Data is fetched at the app level via useAppDataOrchestrator
 *
 * Returns array of projects (empty array if none)
 *
 * @example
 * const projects = useProjects();
 * projects.forEach(project => console.log(project.name));
 */
export function useProjects(): Project[] {
  return useCollection("projects");
}
