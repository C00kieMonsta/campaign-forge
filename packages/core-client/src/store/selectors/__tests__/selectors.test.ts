/**
 * Selector Tests
 *
 * Verifies that all selector functions correctly access and transform store state.
 * Tests entity selectors, collection selectors, relationship selectors, and UI selectors.
 */

import type { Client, ExtractionJob, Project } from "@packages/types";
import { describe, expect, it } from "vitest";
import { createAppStore } from "../../store";
import {
  setClient,
  setClients,
  setExtractionJob,
  setExtractionJobs,
  setExtractionResult,
  setExtractionSchema,
  setProject,
  setProjects,
  setSupplier
} from "../../slices/entities-slice";
import {
  setClientSearch,
  setDateRangeFilter,
  setJobStatusFilter,
  setProjectStatusFilter,
  setSelectedClientId,
  setSelectedProjectId
} from "../../slices/ui-slice";
import {
  selectActiveExtractionJobs,
  selectAllClients,
  selectAllExtractionJobs,
  selectAllProjects,
  selectClientById,
  selectClientForProject,
  selectClientsBySearch,
  selectClientSearchFilter,
  selectClientWithProjects,
  selectCompletedExtractionJobs,
  selectExtractionJobById,
  selectExtractionJobsByDateRange,
  selectExtractionJobsBySchemaId,
  selectExtractionJobsByStatus,
  selectExtractionResultById,
  selectExtractionResultsByJobId,
  selectExtractionSchemaById,
  selectJobCountForSchema,
  selectJobForResult,
  selectJobsForSchema,
  selectJobStatusFilter,
  selectJobWithResults,
  selectJobWithSchema,
  selectProjectById,
  selectProjectCountForClient,
  selectProjectsByClientId,
  selectProjectsByDateRange,
  selectProjectsByStatus,
  selectProjectsForClient,
  selectProjectStatusFilter,
  selectProjectWithClient,
  selectResultCountForJob,
  selectResultsForJob,
  selectResultWithJob,
  selectSchemaForJob,
  selectSelectedClient,
  selectSelectedClientId,
  selectSelectedProject,
  selectSelectedProjectId,
  selectSupplierById,
  selectSuppliersBySearch
} from "../index";

describe("Entity Selectors", () => {
  it("should select client by ID", () => {
    const store = createAppStore();
    const client: Client = {
      id: "client-1",
      name: "Test Client",
      organizationId: "org-1",
      description: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    store.dispatch(setClient(client));

    const result = selectClientById(store.getState(), "client-1");
    expect(result).toEqual(client);
  });

  it("should return null for non-existent client", () => {
    const store = createAppStore();
    const result = selectClientById(store.getState(), "non-existent");
    expect(result).toBeNull();
  });

  it("should select all clients", () => {
    const store = createAppStore();
    const clients: Client[] = [
      {
        id: "client-1",
        name: "Client 1",
        organizationId: "org-1",
        description: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        address: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "client-2",
        name: "Client 2",
        organizationId: "org-1",
        description: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        address: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    store.dispatch(setClients(clients));

    const result = selectAllClients(store.getState());
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining(clients));
  });

  it("should select project by ID", () => {
    const store = createAppStore();
    const project: Project = {
      id: "project-1",
      name: "Test Project",
      organizationId: "org-1",
      clientId: "client-1",
      description: null,
      status: "active",
      location: null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    store.dispatch(setProject(project));

    const result = selectProjectById(store.getState(), "project-1");
    expect(result).toEqual(project);
  });

  it("should select extraction job by ID", () => {
    const store = createAppStore();
    const job: ExtractionJob = {
      id: "job-1",
      organizationId: "org-1",
      initiatedBy: "user-1",
      schemaId: "schema-1",
      jobType: "extraction",
      status: "pending",
      progressPercentage: 0,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      config: {},
      logs: [],
      compiledJsonSchema: {},
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    store.dispatch(setExtractionJob(job));

    const result = selectExtractionJobById(store.getState(), "job-1");
    expect(result).toEqual(job);
  });
});

describe("Collection Selectors", () => {
  it("should filter clients by search term", () => {
    const store = createAppStore();
    const clients: Client[] = [
      {
        id: "client-1",
        name: "Acme Corp",
        organizationId: "org-1",
        description: null,
        contactName: "John Doe",
        contactEmail: "john@acme.com",
        contactPhone: null,
        address: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "client-2",
        name: "Beta Inc",
        organizationId: "org-1",
        description: null,
        contactName: "Jane Smith",
        contactEmail: "jane@beta.com",
        contactPhone: null,
        address: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    store.dispatch(setClients(clients));

    const result = selectClientsBySearch(store.getState(), "acme");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Acme Corp");
  });

  it("should return all clients when search term is empty", () => {
    const store = createAppStore();
    const clients: Client[] = [
      {
        id: "client-1",
        name: "Acme Corp",
        organizationId: "org-1",
        description: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        address: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    store.dispatch(setClients(clients));

    const result = selectClientsBySearch(store.getState(), "");
    expect(result).toHaveLength(1);
  });

  it("should filter projects by status", () => {
    const store = createAppStore();
    const projects: Project[] = [
      {
        id: "project-1",
        name: "Project 1",
        organizationId: "org-1",
        clientId: "client-1",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "project-2",
        name: "Project 2",
        organizationId: "org-1",
        clientId: "client-1",
        description: null,
        status: "completed",
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    store.dispatch(setProjects(projects));

    const result = selectProjectsByStatus(store.getState(), ["active"]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("active");
  });

  it("should filter projects by client ID", () => {
    const store = createAppStore();
    const projects: Project[] = [
      {
        id: "project-1",
        name: "Project 1",
        organizationId: "org-1",
        clientId: "client-1",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "project-2",
        name: "Project 2",
        organizationId: "org-1",
        clientId: "client-2",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    store.dispatch(setProjects(projects));

    const result = selectProjectsByClientId(store.getState(), "client-1");
    expect(result).toHaveLength(1);
    expect(result[0].clientId).toBe("client-1");
  });

  it("should filter extraction jobs by status", () => {
    const store = createAppStore();
    const jobs: ExtractionJob[] = [
      {
        id: "job-1",
        organizationId: "org-1",
        initiatedBy: "user-1",
        schemaId: "schema-1",
        jobType: "extraction",
        status: "pending",
        progressPercentage: 0,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        config: {},
        logs: [],
        compiledJsonSchema: {},
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "job-2",
        organizationId: "org-1",
        initiatedBy: "user-1",
        schemaId: "schema-1",
        jobType: "extraction",
        status: "completed",
        progressPercentage: 100,
        startedAt: new Date(),
        completedAt: new Date(),
        errorMessage: null,
        config: {},
        logs: [],
        compiledJsonSchema: {},
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    store.dispatch(setExtractionJobs(jobs));

    const result = selectExtractionJobsByStatus(store.getState(), ["pending"]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("pending");
  });

  it("should select active extraction jobs", () => {
    const store = createAppStore();
    const jobs: ExtractionJob[] = [
      {
        id: "job-1",
        organizationId: "org-1",
        initiatedBy: "user-1",
        schemaId: "schema-1",
        jobType: "extraction",
        status: "processing",
        progressPercentage: 50,
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
        config: {},
        logs: [],
        compiledJsonSchema: {},
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "job-2",
        organizationId: "org-1",
        initiatedBy: "user-1",
        schemaId: "schema-1",
        jobType: "extraction",
        status: "completed",
        progressPercentage: 100,
        startedAt: new Date(),
        completedAt: new Date(),
        errorMessage: null,
        config: {},
        logs: [],
        compiledJsonSchema: {},
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    store.dispatch(setExtractionJobs(jobs));

    const result = selectActiveExtractionJobs(store.getState());
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("processing");
  });

  it("should select completed extraction jobs", () => {
    const store = createAppStore();
    const jobs: ExtractionJob[] = [
      {
        id: "job-1",
        organizationId: "org-1",
        initiatedBy: "user-1",
        schemaId: "schema-1",
        jobType: "extraction",
        status: "processing",
        progressPercentage: 50,
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
        config: {},
        logs: [],
        compiledJsonSchema: {},
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "job-2",
        organizationId: "org-1",
        initiatedBy: "user-1",
        schemaId: "schema-1",
        jobType: "extraction",
        status: "completed",
        progressPercentage: 100,
        startedAt: new Date(),
        completedAt: new Date(),
        errorMessage: null,
        config: {},
        logs: [],
        compiledJsonSchema: {},
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    store.dispatch(setExtractionJobs(jobs));

    const result = selectCompletedExtractionJobs(store.getState());
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("completed");
  });

  it("should filter projects by date range", () => {
    const store = createAppStore();
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const projects: Project[] = [
      {
        id: "project-1",
        name: "Project 1",
        organizationId: "org-1",
        clientId: "client-1",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: yesterday,
        updatedAt: yesterday
      },
      {
        id: "project-2",
        name: "Project 2",
        organizationId: "org-1",
        clientId: "client-1",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: tomorrow,
        updatedAt: tomorrow
      }
    ];

    store.dispatch(setProjects(projects));

    const result = selectProjectsByDateRange(store.getState(), yesterday, now);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("project-1");
  });
});

describe("Relationship Selectors", () => {
  it("should select projects for a client", () => {
    const store = createAppStore();

    const client: Client = {
      id: "client-1",
      name: "Test Client",
      organizationId: "org-1",
      description: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const projects: Project[] = [
      {
        id: "project-1",
        name: "Project 1",
        organizationId: "org-1",
        clientId: "client-1",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "project-2",
        name: "Project 2",
        organizationId: "org-1",
        clientId: "client-2",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    store.dispatch(setClient(client));
    store.dispatch(setProjects(projects));

    const result = selectProjectsForClient(store.getState(), "client-1");
    expect(result).toHaveLength(1);
    expect(result[0].clientId).toBe("client-1");
  });

  it("should select client for a project", () => {
    const store = createAppStore();

    const client: Client = {
      id: "client-1",
      name: "Test Client",
      organizationId: "org-1",
      description: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const project: Project = {
      id: "project-1",
      name: "Project 1",
      organizationId: "org-1",
      clientId: "client-1",
      description: null,
      status: "active",
      location: null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    store.dispatch(setClient(client));
    store.dispatch(setProject(project));

    const result = selectClientForProject(store.getState(), "project-1");
    expect(result).toEqual(client);
  });

  it("should select project with client", () => {
    const store = createAppStore();

    const client: Client = {
      id: "client-1",
      name: "Test Client",
      organizationId: "org-1",
      description: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const project: Project = {
      id: "project-1",
      name: "Project 1",
      organizationId: "org-1",
      clientId: "client-1",
      description: null,
      status: "active",
      location: null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    store.dispatch(setClient(client));
    store.dispatch(setProject(project));

    const result = selectProjectWithClient(store.getState(), "project-1");
    expect(result).toBeDefined();
    expect(result?.client).toEqual(client);
  });

  it("should select client with projects", () => {
    const store = createAppStore();

    const client: Client = {
      id: "client-1",
      name: "Test Client",
      organizationId: "org-1",
      description: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const projects: Project[] = [
      {
        id: "project-1",
        name: "Project 1",
        organizationId: "org-1",
        clientId: "client-1",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "project-2",
        name: "Project 2",
        organizationId: "org-1",
        clientId: "client-1",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    store.dispatch(setClient(client));
    store.dispatch(setProjects(projects));

    const result = selectClientWithProjects(store.getState(), "client-1");
    expect(result).toBeDefined();
    expect(result?.projects).toHaveLength(2);
  });

  it("should count projects for a client", () => {
    const store = createAppStore();

    const projects: Project[] = [
      {
        id: "project-1",
        name: "Project 1",
        organizationId: "org-1",
        clientId: "client-1",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "project-2",
        name: "Project 2",
        organizationId: "org-1",
        clientId: "client-1",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    store.dispatch(setProjects(projects));

    const result = selectProjectCountForClient(store.getState(), "client-1");
    expect(result).toBe(2);
  });
});

describe("UI Selectors", () => {
  it("should select selected client ID", () => {
    const store = createAppStore();

    store.dispatch(setSelectedClientId("client-1"));

    const result = selectSelectedClientId(store.getState());
    expect(result).toBe("client-1");
  });

  it("should select selected client entity", () => {
    const store = createAppStore();

    const client: Client = {
      id: "client-1",
      name: "Test Client",
      organizationId: "org-1",
      description: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    store.dispatch(setClient(client));
    store.dispatch(setSelectedClientId("client-1"));

    const result = selectSelectedClient(store.getState());
    expect(result).toEqual(client);
  });

  it("should select client search filter", () => {
    const store = createAppStore();

    store.dispatch(setClientSearch("test"));

    const result = selectClientSearchFilter(store.getState());
    expect(result).toBe("test");
  });

  it("should select project status filter", () => {
    const store = createAppStore();

    store.dispatch(setProjectStatusFilter(["active", "completed"]));

    const result = selectProjectStatusFilter(store.getState());
    expect(result).toEqual(["active", "completed"]);
  });

  it("should select job status filter", () => {
    const store = createAppStore();

    store.dispatch(setJobStatusFilter(["pending", "processing"]));

    const result = selectJobStatusFilter(store.getState());
    expect(result).toEqual(["pending", "processing"]);
  });
});
