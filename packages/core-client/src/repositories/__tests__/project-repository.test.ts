/**
 * ProjectRepository Tests
 *
 * Tests for ProjectRepository implementation including:
 * - CRUD operations
 * - Store hydration
 * - Cache integration
 * - Optimistic updates
 * - Archive/restore/permanently delete operations
 */

import type { IDatabaseAdapter, Project } from "@packages/types";
import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import draftsReducer from "../../store/slices/drafts-slice";
import entitiesReducer from "../../store/slices/entities-slice";
import preferencesReducer from "../../store/slices/preferences-slice";
import uiReducer from "../../store/slices/ui-slice";
import { ProjectRepository } from "../project-repository";

/**
 * Create a mock database adapter for testing
 */
function createMockAdapter(): IDatabaseAdapter {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  };
}

/**
 * Create a test store instance
 */
function createTestStore() {
  return configureStore({
    reducer: {
      entities: entitiesReducer,
      ui: uiReducer,
      drafts: draftsReducer,
      preferences: preferencesReducer
    }
  });
}

/**
 * Create a mock project for testing
 */
function createMockProject(overrides?: Partial<Project>): Project {
  return {
    id: "project-1",
    organizationId: "org-1",
    clientId: "client-1",
    name: "Test Project",
    description: "Test Description",
    status: "active",
    location: null,
    meta: {},
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides
  };
}

describe("ProjectRepository", () => {
  let store: ReturnType<typeof createTestStore>;
  let adapter: IDatabaseAdapter;
  let repository: ProjectRepository;

  beforeEach(() => {
    store = createTestStore();
    adapter = createMockAdapter();
    repository = new ProjectRepository({ store, adapter });
  });

  describe("getById", () => {
    it("should fetch project from adapter and hydrate store", async () => {
      const mockProject = createMockProject();
      vi.mocked(adapter.get).mockResolvedValue(mockProject);

      const result = await repository.getById("project-1");

      expect(adapter.get).toHaveBeenCalledWith("/projects/project-1");
      expect(result).toEqual(mockProject);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.projects["project-1"]).toEqual(mockProject);
    });

    it("should return null when project not found", async () => {
      vi.mocked(adapter.get).mockResolvedValue(null);

      const result = await repository.getById("nonexistent");

      expect(result).toBeNull();
    });

    it("should throw error on adapter failure", async () => {
      vi.mocked(adapter.get).mockRejectedValue(new Error("Network error"));

      await expect(repository.getById("project-1")).rejects.toThrow(
        "Network error"
      );
    });
  });

  describe("getAll", () => {
    it("should fetch all projects and hydrate store", async () => {
      const mockProjects = [
        createMockProject({ id: "project-1", name: "Project 1" }),
        createMockProject({ id: "project-2", name: "Project 2" })
      ];
      vi.mocked(adapter.get).mockResolvedValue({
        projects: mockProjects,
        total: mockProjects.length
      });

      const result = await repository.getAll();

      expect(adapter.get).toHaveBeenCalledWith("/projects", undefined);
      expect(result).toEqual(mockProjects);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.projects["project-1"]).toEqual(mockProjects[0]);
      expect(state.entities.projects["project-2"]).toEqual(mockProjects[1]);
    });

    it("should pass filters to adapter", async () => {
      vi.mocked(adapter.get).mockResolvedValue({ projects: [], total: 0 });

      await repository.getAll({ clientId: "client-1" });

      expect(adapter.get).toHaveBeenCalledWith("/projects", {
        clientId: "client-1"
      });
    });
  });

  describe("create", () => {
    it("should create project and hydrate store", async () => {
      const newProjectData = {
        organizationId: "org-1",
        clientId: "client-1",
        name: "New Project",
        description: null,
        status: "active" as const,
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const createdProject = createMockProject({
        id: "project-new",
        ...newProjectData
      });
      vi.mocked(adapter.post).mockResolvedValue(createdProject);

      const result = await repository.create(newProjectData);

      expect(adapter.post).toHaveBeenCalledWith("/projects", newProjectData);
      expect(result).toEqual(createdProject);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.projects["project-new"]).toEqual(createdProject);
    });
  });

  describe("update", () => {
    it("should update project and hydrate store", async () => {
      const updates = { name: "Updated Name" };
      const updatedProject = createMockProject({ ...updates });
      vi.mocked(adapter.patch).mockResolvedValue(updatedProject);

      const result = await repository.update("project-1", updates);

      expect(adapter.patch).toHaveBeenCalledWith(
        "/projects/project-1",
        updates
      );
      expect(result).toEqual(updatedProject);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.projects["project-1"]).toEqual(updatedProject);
    });
  });

  describe("delete", () => {
    it("should delete project and remove from store", async () => {
      // First add a project to the store
      const mockProject = createMockProject();
      store.dispatch({
        type: "entities/setProject",
        payload: mockProject
      });

      vi.mocked(adapter.delete).mockResolvedValue(undefined);

      await repository.delete("project-1");

      expect(adapter.delete).toHaveBeenCalledWith("/projects/project-1");

      // Verify project was removed from store
      const state = store.getState();
      expect(state.entities.projects["project-1"]).toBeUndefined();
    });
  });

  describe("updateOptimistic", () => {
    it("should perform optimistic update and sync with backend", async () => {
      // First add a project to the store
      const originalProject = createMockProject({ name: "Original Name" });
      store.dispatch({
        type: "entities/setProject",
        payload: originalProject
      });

      const updates = { name: "Optimistic Name" };
      const serverProject = createMockProject({ name: "Server Name" });
      vi.mocked(adapter.patch).mockResolvedValue(serverProject);

      const result = await repository.updateOptimistic("project-1", updates);

      expect(result).toEqual(serverProject);

      // Verify final state matches server response
      const state = store.getState();
      expect(state.entities.projects["project-1"]).toEqual(serverProject);
    });

    it("should rollback on failure", async () => {
      // First add a project to the store
      const originalProject = createMockProject({ name: "Original Name" });
      store.dispatch({
        type: "entities/setProject",
        payload: originalProject
      });

      const updates = { name: "Optimistic Name" };
      vi.mocked(adapter.patch).mockRejectedValue(new Error("Update failed"));

      await expect(
        repository.updateOptimistic("project-1", updates)
      ).rejects.toThrow("Update failed");

      // Verify state was rolled back to original
      const state = store.getState();
      expect(state.entities.projects["project-1"]).toEqual(originalProject);
    });

    it("should set error state in UI slice on failure", async () => {
      // First add a project to the store
      const originalProject = createMockProject({ name: "Original Name" });
      store.dispatch({
        type: "entities/setProject",
        payload: originalProject
      });

      const updates = { name: "Optimistic Name" };
      vi.mocked(adapter.patch).mockRejectedValue(new Error("Network error"));

      await expect(
        repository.updateOptimistic("project-1", updates)
      ).rejects.toThrow("Network error");

      // Verify error state was set in UI slice
      const state = store.getState();
      expect(state.ui.errors.projects).toBe("Network error");
    });

    it("should clear error state before optimistic update", async () => {
      // First add a project to the store
      const originalProject = createMockProject({ name: "Original Name" });
      store.dispatch({
        type: "entities/setProject",
        payload: originalProject
      });

      // Set an existing error
      store.dispatch({
        type: "ui/setProjectsError",
        payload: "Previous error"
      });

      const updates = { name: "Optimistic Name" };
      const serverProject = createMockProject({ name: "Server Name" });
      vi.mocked(adapter.patch).mockResolvedValue(serverProject);

      await repository.updateOptimistic("project-1", updates);

      // Verify error state was cleared
      const state = store.getState();
      expect(state.ui.errors.projects).toBeNull();
    });

    it("should throw error if entity not in store", async () => {
      await expect(
        repository.updateOptimistic("nonexistent", { name: "Test" })
      ).rejects.toThrow("Entity nonexistent not found in store");
    });
  });

  describe("IProjectRepository interface methods", () => {
    describe("getProjectById", () => {
      it("should delegate to getById", async () => {
        const mockProject = createMockProject();
        vi.mocked(adapter.get).mockResolvedValue(mockProject);

        const result = await repository.getProjectById("project-1");

        expect(adapter.get).toHaveBeenCalledWith("/projects/project-1");
        expect(result).toEqual(mockProject);
      });
    });

    describe("getProjectsByOrganization", () => {
      it("should fetch projects filtered by organization", async () => {
        const mockProjects = [
          createMockProject({ id: "project-1", organizationId: "org-1" }),
          createMockProject({ id: "project-2", organizationId: "org-1" })
        ];
        vi.mocked(adapter.get).mockResolvedValue({
          projects: mockProjects,
          total: mockProjects.length
        });

        const result = await repository.getProjectsByOrganization("org-1");

        expect(adapter.get).toHaveBeenCalledWith("/projects", {
          organizationId: "org-1"
        });
        expect(result).toEqual(mockProjects);
      });
    });

    describe("getProjectsByClient", () => {
      it("should fetch projects filtered by organization and client", async () => {
        const mockProjects = [
          createMockProject({
            id: "project-1",
            organizationId: "org-1",
            clientId: "client-1"
          }),
          createMockProject({
            id: "project-2",
            organizationId: "org-1",
            clientId: "client-1"
          })
        ];
        vi.mocked(adapter.get).mockResolvedValue({
          projects: mockProjects,
          total: mockProjects.length
        });

        const result = await repository.getProjectsByClient(
          "org-1",
          "client-1"
        );

        expect(adapter.get).toHaveBeenCalledWith("/projects", {
          organizationId: "org-1",
          clientId: "client-1"
        });
        expect(result).toEqual(mockProjects);
      });
    });

    describe("createProject", () => {
      it("should create project with DTO transformation", async () => {
        const createData = {
          organizationId: "org-1",
          createdBy: "user-1",
          clientId: "client-1",
          name: "New Project",
          description: "Test Description",
          location: { address: "123 Main St" }
        };
        const createdProject = createMockProject({
          id: "project-new",
          organizationId: createData.organizationId,
          clientId: createData.clientId,
          name: createData.name,
          description: createData.description,
          location: createData.location
        });
        vi.mocked(adapter.post).mockResolvedValue(createdProject);

        const result = await repository.createProject(createData);

        expect(adapter.post).toHaveBeenCalledWith(
          "/projects",
          expect.objectContaining({
            organizationId: "org-1",
            clientId: "client-1",
            name: "New Project",
            description: "Test Description",
            location: { address: "123 Main St" },
            status: "active"
          })
        );
        expect(result).toEqual(createdProject);
      });
    });

    describe("updateProject", () => {
      it("should update project with DTO transformation", async () => {
        const updateData = {
          name: "Updated Name",
          status: "completed" as const
        };
        const updatedProject = createMockProject({ ...updateData });
        vi.mocked(adapter.patch).mockResolvedValue(updatedProject);

        const result = await repository.updateProject("project-1", updateData);

        expect(adapter.patch).toHaveBeenCalledWith(
          "/projects/project-1",
          expect.objectContaining({
            name: "Updated Name",
            status: "completed"
          })
        );
        expect(result).toEqual(updatedProject);
      });
    });

    describe("deleteProject", () => {
      it("should delegate to delete", async () => {
        const mockProject = createMockProject();
        store.dispatch({
          type: "entities/setProject",
          payload: mockProject
        });

        vi.mocked(adapter.delete).mockResolvedValue(undefined);

        await repository.deleteProject("project-1");

        expect(adapter.delete).toHaveBeenCalledWith("/projects/project-1");

        const state = store.getState();
        expect(state.entities.projects["project-1"]).toBeUndefined();
      });
    });

    describe("archiveProjects", () => {
      it("should archive multiple projects and invalidate cache", async () => {
        const projectIds = ["project-1", "project-2"];
        vi.mocked(adapter.patch).mockResolvedValue(undefined);

        await repository.archiveProjects(projectIds);

        expect(adapter.patch).toHaveBeenCalledWith("/projects/archive", {
          projectIds
        });
      });
    });

    describe("restoreProjects", () => {
      it("should restore multiple projects and invalidate cache", async () => {
        const projectIds = ["project-1", "project-2"];
        vi.mocked(adapter.patch).mockResolvedValue(undefined);

        await repository.restoreProjects(projectIds);

        expect(adapter.patch).toHaveBeenCalledWith("/projects/restore", {
          projectIds
        });
      });
    });

    describe("permanentlyDeleteProjects", () => {
      it("should permanently delete multiple projects and remove from store", async () => {
        // First add projects to the store
        const mockProjects = [
          createMockProject({ id: "project-1" }),
          createMockProject({ id: "project-2" })
        ];
        mockProjects.forEach((project) => {
          store.dispatch({
            type: "entities/setProject",
            payload: project
          });
        });

        const projectIds = ["project-1", "project-2"];
        vi.mocked(adapter.post).mockResolvedValue(undefined);

        await repository.permanentlyDeleteProjects(projectIds);

        expect(adapter.post).toHaveBeenCalledWith(
          "/projects/permanently-delete",
          { projectIds }
        );

        // Verify projects were removed from store
        const state = store.getState();
        expect(state.entities.projects["project-1"]).toBeUndefined();
        expect(state.entities.projects["project-2"]).toBeUndefined();
      });
    });

    describe("getProjectsByClientWithPagination", () => {
      it("should fetch paginated projects by client and hydrate store", async () => {
        const mockResponse = {
          projects: [
            createMockProject({ id: "project-1", name: "Project 1" }),
            createMockProject({ id: "project-2", name: "Project 2" })
          ],
          total: 10
        };
        vi.mocked(adapter.get).mockResolvedValue(mockResponse);

        const result = await repository.getProjectsByClientWithPagination(
          "org-1",
          "client-1",
          1,
          10
        );

        expect(adapter.get).toHaveBeenCalledWith("/projects/paginated", {
          organizationId: "org-1",
          clientId: "client-1",
          page: 1,
          limit: 10
        });
        expect(result).toEqual(mockResponse);

        // Verify store was hydrated
        const state = store.getState();
        expect(state.entities.projects["project-1"]).toEqual(
          mockResponse.projects[0]
        );
        expect(state.entities.projects["project-2"]).toEqual(
          mockResponse.projects[1]
        );
      });
    });

    describe("getProjectsByOrganizationWithPagination", () => {
      it("should fetch paginated projects by organization and hydrate store", async () => {
        const mockResponse = {
          projects: [
            createMockProject({ id: "project-1", name: "Project 1" }),
            createMockProject({ id: "project-2", name: "Project 2" })
          ],
          total: 10
        };
        vi.mocked(adapter.get).mockResolvedValue(mockResponse);

        const result = await repository.getProjectsByOrganizationWithPagination(
          "org-1",
          1,
          10
        );

        expect(adapter.get).toHaveBeenCalledWith("/projects/paginated", {
          organizationId: "org-1",
          page: 1,
          limit: 10
        });
        expect(result).toEqual(mockResponse);

        // Verify store was hydrated
        const state = store.getState();
        expect(state.entities.projects["project-1"]).toEqual(
          mockResponse.projects[0]
        );
        expect(state.entities.projects["project-2"]).toEqual(
          mockResponse.projects[1]
        );
      });
    });

    describe("getArchivedProjectsByOrganization", () => {
      it("should fetch archived projects filtered by organization", async () => {
        const mockProjects = [
          createMockProject({
            id: "project-1",
            organizationId: "org-1",
            status: "archived"
          }),
          createMockProject({
            id: "project-2",
            organizationId: "org-1",
            status: "archived"
          })
        ];
        vi.mocked(adapter.get).mockResolvedValue({
          projects: mockProjects,
          total: mockProjects.length
        });

        const result =
          await repository.getArchivedProjectsByOrganization("org-1");

        expect(adapter.get).toHaveBeenCalledWith("/projects", {
          organizationId: "org-1",
          status: "archived"
        });
        expect(result).toEqual(mockProjects);
      });
    });

    describe("getArchivedProjectsByClient", () => {
      it("should fetch archived projects filtered by organization and client", async () => {
        const mockProjects = [
          createMockProject({
            id: "project-1",
            organizationId: "org-1",
            clientId: "client-1",
            status: "archived"
          }),
          createMockProject({
            id: "project-2",
            organizationId: "org-1",
            clientId: "client-1",
            status: "archived"
          })
        ];
        vi.mocked(adapter.get).mockResolvedValue({
          projects: mockProjects,
          total: mockProjects.length
        });

        const result = await repository.getArchivedProjectsByClient(
          "org-1",
          "client-1"
        );

        expect(adapter.get).toHaveBeenCalledWith("/projects", {
          organizationId: "org-1",
          clientId: "client-1",
          status: "archived"
        });
        expect(result).toEqual(mockProjects);
      });
    });
  });
});
