/**
 * Tests for store state type definitions
 * These tests verify that the type definitions are correctly structured
 */

import {
  AppState,
  DraftsState,
  EntitiesState,
  EntityType,
  EntityTypeMap,
  PreferencesState,
  UIState
} from "../index";

describe("Store State Types", () => {
  describe("AppState", () => {
    it("should have all required slices", () => {
      const mockState: AppState = {
        entities: {
          clients: {},
          projects: {},
          extractionJobs: {},
          extractionResults: {},
          extractionSchemas: {},
          suppliers: {},
          organizationMembers: {},
          invitations: {},
          supplierMatches: {},
          dataLayers: {}
        },
        ui: {
          selections: {
            selectedClientId: null,
            selectedProjectId: null,
            selectedJobId: null,
            selectedSupplierId: null
          },
          filters: {
            clientSearch: "",
            projectStatus: [],
            jobStatus: [],
            dateRange: {
              start: null,
              end: null
            }
          },
          loading: {
            clients: false,
            projects: false,
            jobs: false,
            results: false,
            schemas: false,
            suppliers: false,
            organizationMembers: false,
            invitations: false,
            supplierMatches: false
          },
          errors: {
            clients: null,
            projects: null,
            jobs: null,
            results: null,
            schemas: null,
            suppliers: null,
            organizationMembers: null,
            invitations: null,
            supplierMatches: null
          }
        },
        drafts: {
          newClient: null,
          newProject: null,
          newSupplier: null,
          editingClient: null,
          editingProject: null,
          editingSupplier: null
        },
        preferences: {
          theme: "system",
          sidebarCollapsed: false,
          defaultPageSize: 20,
          defaultView: "list",
          selectedClientId: null
        }
      };

      expect(mockState).toBeDefined();
      expect(mockState.entities).toBeDefined();
      expect(mockState.ui).toBeDefined();
      expect(mockState.drafts).toBeDefined();
      expect(mockState.preferences).toBeDefined();
    });
  });

  describe("EntitiesState", () => {
    it("should store entities in normalized Record format", () => {
      const mockEntities: EntitiesState = {
        clients: {
          "client-1": {
            id: "client-1",
            organizationId: "org-1",
            name: "Test Client",
            description: null,
            contactName: null,
            contactEmail: null,
            contactPhone: null,
            address: null,
            meta: {},
            createdAt: new Date(),
            updatedAt: new Date()
          }
        },
        projects: {},
        extractionJobs: {},
        extractionResults: {},
        extractionSchemas: {},
        suppliers: {},
        organizationMembers: {},
        invitations: {},
        supplierMatches: {},
        dataLayers: {}
      };

      expect(mockEntities.clients["client-1"]).toBeDefined();
      expect(mockEntities.clients["client-1"].id).toBe("client-1");
    });
  });

  describe("UIState", () => {
    it("should support selections, filters, loading, and errors", () => {
      const mockUI: UIState = {
        selections: {
          selectedClientId: "client-1",
          selectedProjectId: null,
          selectedJobId: null,
          selectedSupplierId: null
        },
        filters: {
          clientSearch: "test",
          projectStatus: ["active"],
          jobStatus: [],
          dateRange: {
            start: new Date(),
            end: new Date()
          }
        },
        loading: {
          clients: true,
          projects: false,
          jobs: false,
          results: false,
          schemas: false,
          suppliers: false,
          organizationMembers: false,
          invitations: false,
          supplierMatches: false
        },
        errors: {
          clients: "Failed to load clients",
          projects: null,
          jobs: null,
          results: null,
          schemas: null,
          suppliers: null,
          organizationMembers: null,
          invitations: null,
          supplierMatches: null
        }
      };

      expect(mockUI.selections.selectedClientId).toBe("client-1");
      expect(mockUI.filters.clientSearch).toBe("test");
      expect(mockUI.loading.clients).toBe(true);
      expect(mockUI.errors.clients).toBe("Failed to load clients");
    });
  });

  describe("DraftsState", () => {
    it("should support draft entities for forms", () => {
      const mockDrafts: DraftsState = {
        newClient: {
          name: "New Client",
          organizationId: "org-1"
        },
        newProject: null,
        newSupplier: null,
        editingClient: {
          id: "client-1",
          draft: {
            name: "Updated Name"
          }
        },
        editingProject: null,
        editingSupplier: null
      };

      expect(mockDrafts.newClient?.name).toBe("New Client");
      expect(mockDrafts.editingClient?.draft.name).toBe("Updated Name");
    });
  });

  describe("PreferencesState", () => {
    it("should support user preferences", () => {
      const mockPreferences: PreferencesState = {
        theme: "dark",
        sidebarCollapsed: true,
        defaultPageSize: 50,
        defaultView: "grid",
        selectedClientId: null
      };

      expect(mockPreferences.theme).toBe("dark");
      expect(mockPreferences.sidebarCollapsed).toBe(true);
      expect(mockPreferences.defaultPageSize).toBe(50);
      expect(mockPreferences.defaultView).toBe("grid");
    });
  });

  describe("EntityType", () => {
    it("should support all entity type discriminators", () => {
      const entityTypes: EntityType[] = [
        "clients",
        "projects",
        "extractionJobs",
        "extractionResults",
        "extractionSchemas",
        "suppliers"
      ];

      expect(entityTypes).toHaveLength(6);
    });
  });

  describe("EntityTypeMap", () => {
    it("should map entity types to their interfaces", () => {
      // This is a compile-time test - if it compiles, the types are correct
      type ClientType = EntityTypeMap["clients"];
      type ProjectType = EntityTypeMap["projects"];

      const client: ClientType = {
        id: "client-1",
        organizationId: "org-1",
        name: "Test",
        description: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        address: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const project: ProjectType = {
        id: "project-1",
        organizationId: "org-1",
        clientId: "client-1",
        name: "Test Project",
        description: null,
        status: "active",
        location: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      };

      expect(client.id).toBe("client-1");
      expect(project.id).toBe("project-1");
    });
  });
});
