/**
 * Store Configuration Tests
 *
 * Verifies that the Redux store is correctly configured with all slices.
 */

import { describe, expect, it } from "vitest";
import {
  setClient,
  setNewClientDraft,
  setSelectedClientId,
  setTheme
} from "../index";
import { createAppStore } from "../store";

describe("Store Configuration", () => {
  it("should create a store with all slices", () => {
    const store = createAppStore();
    const state = store.getState();

    // Verify all slices exist
    expect(state).toHaveProperty("entities");
    expect(state).toHaveProperty("ui");
    expect(state).toHaveProperty("drafts");
    expect(state).toHaveProperty("preferences");
  });

  it("should have empty entities slice initially", () => {
    const store = createAppStore();
    const state = store.getState();

    expect(state.entities.clients).toEqual({});
    expect(state.entities.projects).toEqual({});
    expect(state.entities.extractionJobs).toEqual({});
    expect(state.entities.extractionResults).toEqual({});
    expect(state.entities.extractionSchemas).toEqual({});
    expect(state.entities.suppliers).toEqual({});
  });

  it("should have default UI state", () => {
    const store = createAppStore();
    const state = store.getState();

    expect(state.ui.selections.selectedClientId).toBeNull();
    expect(state.ui.filters.clientSearch).toBe("");
    expect(state.ui.loading.clients).toBe(false);
    expect(state.ui.errors.clients).toBeNull();
  });

  it("should have empty drafts initially", () => {
    const store = createAppStore();
    const state = store.getState();

    expect(state.drafts.newClient).toBeNull();
    expect(state.drafts.editingClient).toBeNull();
  });

  it("should have default preferences", () => {
    const store = createAppStore();
    const state = store.getState();

    expect(state.preferences.theme).toBe("system");
    expect(state.preferences.sidebarCollapsed).toBe(false);
    expect(state.preferences.defaultPageSize).toBe(20);
    expect(state.preferences.defaultView).toBe("list");
  });

  it("should handle entity actions", () => {
    const store = createAppStore();

    const client = {
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

    const state = store.getState();
    expect(state.entities.clients["client-1"]).toEqual(client);
  });

  it("should handle UI actions", () => {
    const store = createAppStore();

    store.dispatch(setSelectedClientId("client-1"));

    const state = store.getState();
    expect(state.ui.selections.selectedClientId).toBe("client-1");
  });

  it("should handle draft actions", () => {
    const store = createAppStore();

    const draft = { name: "New Client" };
    store.dispatch(setNewClientDraft(draft));

    const state = store.getState();
    expect(state.drafts.newClient).toEqual(draft);
  });

  it("should handle preference actions", () => {
    const store = createAppStore();

    store.dispatch(setTheme("dark"));

    const state = store.getState();
    expect(state.preferences.theme).toBe("dark");
  });
});
