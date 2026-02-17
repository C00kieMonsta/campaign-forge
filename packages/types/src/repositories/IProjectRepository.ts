// src/persistence/IProjectRepository.ts
import { CreateProjectRequest, UpdateProjectRequest } from "../dto/projects";
import { Project } from "../entities/project";

export interface CreateProjectData extends CreateProjectRequest {
  organizationId: string;
  createdBy: string;
}

export interface IProjectRepository {
  getProjectById(projectId: string): Promise<Project | null>;
  getProjectsByOrganization(organizationId: string): Promise<Project[]>;
  getProjectsByClient(
    organizationId: string,
    clientId: string
  ): Promise<Project[]>;
  createProject(data: CreateProjectData): Promise<Project>;
  updateProject(
    projectId: string,
    data: UpdateProjectRequest
  ): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  archiveProjects(projectIds: string[]): Promise<void>;
  restoreProjects(projectIds: string[]): Promise<void>;
  permanentlyDeleteProjects(projectIds: string[]): Promise<void>;
  getProjectsByClientWithPagination(
    organizationId: string,
    clientId: string,
    page: number,
    limit: number
  ): Promise<{ projects: Project[]; total: number }>;
  getProjectsByOrganizationWithPagination(
    organizationId: string,
    page: number,
    limit: number
  ): Promise<{ projects: Project[]; total: number }>;
  getArchivedProjectsByOrganization(organizationId: string): Promise<Project[]>;
  getArchivedProjectsByClient(
    organizationId: string,
    clientId: string
  ): Promise<Project[]>;
}
