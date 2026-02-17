/**
 * ClientRepository Tests
 *
 * Tests for ClientRepository implementation including:
 * - CRUD operations
 * - Store hydration
 * - Cache integration
 * - Optimistic updates
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import type { Client } from "@packages/types";
import { ClientRepository } from "../client-repository";
import entitiesReducer from "../../store/slices/entities-slice";
import uiReducer from "../../store/slices/ui-slice";
import draftsReducer from "../../store/slices/drafts-slice";
import preferencesReducer from "../../store/slices/preferences-slice";
import type { IDatabaseAdapter } from "@packages/types";

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
 * Create a mock client for testing
 */
function createMockClient(overrides?: Partial<Client>): Client {
  return {
    id: "client-1",
    organizationId: "org-1",
    name: "Test Client",
    description: "Test Description",
    contactName: "John Doe",
    contactEmail: "john@example.com",
    contactPhone: "+1234567890",
    address: null,
    meta: {},
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides
  };
}

describe("ClientRepository", () => {
  let store: ReturnType<typeof createTestStore>;
  let adapter: IDatabaseAdapter;
  let repository: ClientRepository;

  beforeEach(() => {
    store = createTestStore();
    adapter = createMockAdapter();
    repository = new ClientRepository({ store, adapter });
  });

  describe("getById", () => {
    it("should fetch client from adapter and hydrate store", async () => {
      const mockClient = createMockClient();
      vi.mocked(adapter.get).mockResolvedValue(mockClient);

      const result = await repository.getById("client-1");

      expect(adapter.get).toHaveBeenCalledWith("/clients/client-1");
      expect(result).toEqual(mockClient);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.clients["client-1"]).toEqual(mockClient);
    });

    it("should return null when client not found", async () => {
      vi.mocked(adapter.get).mockResolvedValue(null);

      const result = await repository.getById("nonexistent");

      expect(result).toBeNull();
    });

    it("should throw error on adapter failure", async () => {
      vi.mocked(adapter.get).mockRejectedValue(new Error("Network error"));

      await expect(repository.getById("client-1")).rejects.toThrow(
        "Network error"
      );
    });
  });

  describe("getAll", () => {
    it("should fetch all clients and hydrate store", async () => {
      const mockClients = [
        createMockClient({ id: "client-1", name: "Client 1" }),
        createMockClient({ id: "client-2", name: "Client 2" })
      ];
      vi.mocked(adapter.get).mockResolvedValue(mockClients);

      const result = await repository.getAll();

      expect(adapter.get).toHaveBeenCalledWith("/clients", undefined);
      expect(result).toEqual(mockClients);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.clients["client-1"]).toEqual(mockClients[0]);
      expect(state.entities.clients["client-2"]).toEqual(mockClients[1]);
    });

    it("should pass filters to adapter", async () => {
      vi.mocked(adapter.get).mockResolvedValue([]);

      await repository.getAll({ name: "Test" });

      expect(adapter.get).toHaveBeenCalledWith("/clients", { name: "Test" });
    });
  });

  describe("create", () => {
    it("should create client and hydrate store", async () => {
      const newClientData = {
        organizationId: "org-1",
        name: "New Client",
        description: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        address: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const createdClient = createMockClient({
        id: "client-new",
        ...newClientData
      });
      vi.mocked(adapter.post).mockResolvedValue(createdClient);

      const result = await repository.create(newClientData);

      expect(adapter.post).toHaveBeenCalledWith("/clients", newClientData);
      expect(result).toEqual(createdClient);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.clients["client-new"]).toEqual(createdClient);
    });
  });

  describe("update", () => {
    it("should update client and hydrate store", async () => {
      const updates = { name: "Updated Name" };
      const updatedClient = createMockClient({ ...updates });
      vi.mocked(adapter.patch).mockResolvedValue(updatedClient);

      const result = await repository.update("client-1", updates);

      expect(adapter.patch).toHaveBeenCalledWith("/clients/client-1", updates);
      expect(result).toEqual(updatedClient);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.clients["client-1"]).toEqual(updatedClient);
    });
  });

  describe("delete", () => {
    it("should delete client and remove from store", async () => {
      // First add a client to the store
      const mockClient = createMockClient();
      store.dispatch({
        type: "entities/setClient",
        payload: mockClient
      });

      vi.mocked(adapter.delete).mockResolvedValue(undefined);

      await repository.delete("client-1");

      expect(adapter.delete).toHaveBeenCalledWith("/clients/client-1");

      // Verify client was removed from store
      const state = store.getState();
      expect(state.entities.clients["client-1"]).toBeUndefined();
    });
  });

  describe("updateOptimistic", () => {
    it("should perform optimistic update and sync with backend", async () => {
      // First add a client to the store
      const originalClient = createMockClient({ name: "Original Name" });
      store.dispatch({
        type: "entities/setClient",
        payload: originalClient
      });

      const updates = { name: "Optimistic Name" };
      const serverClient = createMockClient({ name: "Server Name" });
      vi.mocked(adapter.patch).mockResolvedValue(serverClient);

      const result = await repository.updateOptimistic("client-1", updates);

      expect(result).toEqual(serverClient);

      // Verify final state matches server response
      const state = store.getState();
      expect(state.entities.clients["client-1"]).toEqual(serverClient);
    });

    it("should rollback on failure", async () => {
      // First add a client to the store
      const originalClient = createMockClient({ name: "Original Name" });
      store.dispatch({
        type: "entities/setClient",
        payload: originalClient
      });

      const updates = { name: "Optimistic Name" };
      vi.mocked(adapter.patch).mockRejectedValue(new Error("Update failed"));

      await expect(
        repository.updateOptimistic("client-1", updates)
      ).rejects.toThrow("Update failed");

      // Verify state was rolled back to original
      const state = store.getState();
      expect(state.entities.clients["client-1"]).toEqual(originalClient);
    });

    it("should set error state in UI slice on failure", async () => {
      // First add a client to the store
      const originalClient = createMockClient({ name: "Original Name" });
      store.dispatch({
        type: "entities/setClient",
        payload: originalClient
      });

      const updates = { name: "Optimistic Name" };
      vi.mocked(adapter.patch).mockRejectedValue(new Error("Network error"));

      await expect(
        repository.updateOptimistic("client-1", updates)
      ).rejects.toThrow("Network error");

      // Verify error state was set in UI slice
      const state = store.getState();
      expect(state.ui.errors.clients).toBe("Network error");
    });

    it("should clear error state before optimistic update", async () => {
      // First add a client to the store
      const originalClient = createMockClient({ name: "Original Name" });
      store.dispatch({
        type: "entities/setClient",
        payload: originalClient
      });

      // Set an existing error
      store.dispatch({
        type: "ui/setClientsError",
        payload: "Previous error"
      });

      const updates = { name: "Optimistic Name" };
      const serverClient = createMockClient({ name: "Server Name" });
      vi.mocked(adapter.patch).mockResolvedValue(serverClient);

      await repository.updateOptimistic("client-1", updates);

      // Verify error state was cleared
      const state = store.getState();
      expect(state.ui.errors.clients).toBeNull();
    });

    it("should throw error if entity not in store", async () => {
      await expect(
        repository.updateOptimistic("nonexistent", { name: "Test" })
      ).rejects.toThrow("Entity nonexistent not found in store");
    });
  });

  describe("IClientRepository interface methods", () => {
    describe("getClientById", () => {
      it("should delegate to getById", async () => {
        const mockClient = createMockClient();
        vi.mocked(adapter.get).mockResolvedValue(mockClient);

        const result = await repository.getClientById("client-1");

        expect(adapter.get).toHaveBeenCalledWith("/clients/client-1");
        expect(result).toEqual(mockClient);
      });
    });

    describe("getClientsByOrganization", () => {
      it("should fetch clients filtered by organization", async () => {
        const mockClients = [
          createMockClient({ id: "client-1", organizationId: "org-1" }),
          createMockClient({ id: "client-2", organizationId: "org-1" })
        ];
        vi.mocked(adapter.get).mockResolvedValue(mockClients);

        const result = await repository.getClientsByOrganization("org-1");

        expect(adapter.get).toHaveBeenCalledWith("/clients", {
          organizationId: "org-1"
        });
        expect(result).toEqual(mockClients);
      });
    });

    describe("createClient", () => {
      it("should create client with DTO transformation", async () => {
        const createData = {
          organizationId: "org-1",
          name: "New Client",
          description: "Test Description",
          contactEmail: "test@example.com"
        };
        const createdClient = createMockClient({
          id: "client-new",
          ...createData
        });
        vi.mocked(adapter.post).mockResolvedValue(createdClient);

        const result = await repository.createClient(createData);

        expect(adapter.post).toHaveBeenCalledWith(
          "/clients",
          expect.objectContaining({
            organizationId: "org-1",
            name: "New Client",
            description: "Test Description",
            contactEmail: "test@example.com"
          })
        );
        expect(result).toEqual(createdClient);
      });
    });

    describe("updateClient", () => {
      it("should update client with DTO transformation", async () => {
        const updateData = {
          name: "Updated Name",
          contactEmail: "updated@example.com"
        };
        const updatedClient = createMockClient({ ...updateData });
        vi.mocked(adapter.patch).mockResolvedValue(updatedClient);

        const result = await repository.updateClient("client-1", updateData);

        expect(adapter.patch).toHaveBeenCalledWith(
          "/clients/client-1",
          expect.objectContaining({
            name: "Updated Name",
            contactEmail: "updated@example.com"
          })
        );
        expect(result).toEqual(updatedClient);
      });
    });

    describe("deleteClient", () => {
      it("should delegate to delete", async () => {
        const mockClient = createMockClient();
        store.dispatch({
          type: "entities/setClient",
          payload: mockClient
        });

        vi.mocked(adapter.delete).mockResolvedValue(undefined);

        await repository.deleteClient("client-1");

        expect(adapter.delete).toHaveBeenCalledWith("/clients/client-1");

        const state = store.getState();
        expect(state.entities.clients["client-1"]).toBeUndefined();
      });
    });

    describe("getClientsByOrganizationWithPagination", () => {
      it("should fetch paginated clients and hydrate store", async () => {
        const mockResponse = {
          clients: [
            createMockClient({ id: "client-1", name: "Client 1" }),
            createMockClient({ id: "client-2", name: "Client 2" })
          ],
          total: 10
        };
        vi.mocked(adapter.get).mockResolvedValue(mockResponse);

        const result = await repository.getClientsByOrganizationWithPagination(
          "org-1",
          1,
          10
        );

        expect(adapter.get).toHaveBeenCalledWith("/clients/paginated", {
          organizationId: "org-1",
          page: 1,
          limit: 10
        });
        expect(result).toEqual(mockResponse);

        // Verify store was hydrated
        const state = store.getState();
        expect(state.entities.clients["client-1"]).toEqual(
          mockResponse.clients[0]
        );
        expect(state.entities.clients["client-2"]).toEqual(
          mockResponse.clients[1]
        );
      });
    });
  });
});
