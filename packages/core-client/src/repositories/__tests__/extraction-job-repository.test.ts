/**
 * ExtractionJobRepository Tests
 *
 * Tests for ExtractionJobRepository implementation including:
 * - CRUD operations
 * - Store hydration
 * - WebSocket subscription and message handling
 * - Short-TTL cache integration
 * - Optimistic updates
 */

import type {
  ExtractionJob,
  IDatabaseAdapter,
  IWebSocketService,
  WebSocketHandler,
  WebSocketPayload
} from "@packages/types";
import { TABLE_NAMES } from "@packages/types";
import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import draftsReducer from "../../store/slices/drafts-slice";
import entitiesReducer from "../../store/slices/entities-slice";
import preferencesReducer from "../../store/slices/preferences-slice";
import uiReducer from "../../store/slices/ui-slice";
import { ExtractionJobRepository } from "../extraction-job-repository";

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
 * Extended mock WebSocket service type with test helper
 */
type MockWebSocketService = IWebSocketService & {
  _triggerHandler: (channel: string, payload: WebSocketPayload) => void;
};

/**
 * Create a mock WebSocket service for testing
 */
function createMockWebSocketService(): MockWebSocketService {
  const handlers = new Map<string, Set<WebSocketHandler>>();

  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe: vi.fn((channel: string, handler: WebSocketHandler) => {
      if (!handlers.has(channel)) {
        handlers.set(channel, new Set());
      }
      handlers.get(channel)!.add(handler);
    }),
    unsubscribe: vi.fn((channel: string, handler: WebSocketHandler) => {
      const channelHandlers = handlers.get(channel);
      if (channelHandlers) {
        channelHandlers.delete(handler);
      }
    }),
    isConnected: vi.fn().mockReturnValue(true),
    // Helper method to trigger handlers (not part of interface)
    _triggerHandler: (channel: string, payload: WebSocketPayload) => {
      const channelHandlers = handlers.get(channel);
      if (channelHandlers) {
        channelHandlers.forEach((handler) => handler(payload));
      }
    }
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
 * Create a mock extraction job for testing
 */
function createMockExtractionJob(
  overrides?: Partial<ExtractionJob>
): ExtractionJob {
  return {
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
    compiledJsonSchema: null,
    meta: {},
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides
  };
}

describe("ExtractionJobRepository", () => {
  let store: ReturnType<typeof createTestStore>;
  let adapter: IDatabaseAdapter;
  let wsService: MockWebSocketService;
  let repository: ExtractionJobRepository;

  beforeEach(() => {
    store = createTestStore();
    adapter = createMockAdapter();
    wsService = createMockWebSocketService();
    repository = new ExtractionJobRepository({ store, adapter, wsService });
  });

  describe("WebSocket subscription", () => {
    it("should subscribe to WebSocket channel on initialization", () => {
      expect(wsService.subscribe).toHaveBeenCalledWith(
        TABLE_NAMES.EXTRACTION_JOBS,
        expect.any(Function)
      );
      expect(repository.isSubscribed()).toBe(true);
    });

    it("should unsubscribe from WebSocket channel", () => {
      repository.unsubscribe();

      expect(wsService.unsubscribe).toHaveBeenCalledWith(
        TABLE_NAMES.EXTRACTION_JOBS,
        expect.any(Function)
      );
      expect(repository.isSubscribed()).toBe(false);
    });

    it("should not subscribe twice", () => {
      vi.clearAllMocks();
      repository.subscribe();

      expect(wsService.subscribe).not.toHaveBeenCalled();
    });
  });

  describe("WebSocket message handling", () => {
    it("should hydrate store on INSERT operation", () => {
      const mockJob = createMockExtractionJob({ id: "job-new" });
      const payload: WebSocketPayload = {
        op: "INSERT",
        table: TABLE_NAMES.EXTRACTION_JOBS,
        new: mockJob
      };

      wsService._triggerHandler(TABLE_NAMES.EXTRACTION_JOBS, payload);

      const state = store.getState();
      expect(state.entities.extractionJobs["job-new"]).toEqual(mockJob);
    });

    it("should hydrate store on UPDATE operation", () => {
      const mockJob = createMockExtractionJob({
        status: "processing",
        progressPercentage: 50
      });
      const payload: WebSocketPayload = {
        op: "UPDATE",
        table: TABLE_NAMES.EXTRACTION_JOBS,
        new: mockJob
      };

      wsService._triggerHandler(TABLE_NAMES.EXTRACTION_JOBS, payload);

      const state = store.getState();
      expect(state.entities.extractionJobs["job-1"]).toEqual(mockJob);
    });

    it("should remove job from store on DELETE operation", () => {
      // First add a job to the store
      const mockJob = createMockExtractionJob();
      store.dispatch({
        type: "entities/setExtractionJob",
        payload: mockJob
      });

      const payload: WebSocketPayload = {
        op: "DELETE",
        table: TABLE_NAMES.EXTRACTION_JOBS,
        old: { id: "job-1" }
      };

      wsService._triggerHandler(TABLE_NAMES.EXTRACTION_JOBS, payload);

      const state = store.getState();
      expect(state.entities.extractionJobs["job-1"]).toBeUndefined();
    });

    it("should handle invalid payload gracefully", () => {
      const payload: WebSocketPayload = {
        op: "UPDATE",
        table: TABLE_NAMES.EXTRACTION_JOBS
        // No 'new' or 'old' field - should handle gracefully
      };

      // Should not throw
      expect(() => {
        wsService._triggerHandler(TABLE_NAMES.EXTRACTION_JOBS, payload);
      }).not.toThrow();
    });
  });

  describe("getById", () => {
    it("should fetch extraction job from adapter and hydrate store", async () => {
      const mockJob = createMockExtractionJob();
      vi.mocked(adapter.get).mockResolvedValue(mockJob);

      const result = await repository.getById("job-1");

      expect(adapter.get).toHaveBeenCalledWith("/extraction-jobs/job-1");
      expect(result).toEqual(mockJob);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.extractionJobs["job-1"]).toEqual(mockJob);
    });

    it("should return null when job not found", async () => {
      vi.mocked(adapter.get).mockResolvedValue(null);

      const result = await repository.getById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getAll", () => {
    it("should fetch all extraction jobs and hydrate store", async () => {
      const mockJobs = [
        createMockExtractionJob({ id: "job-1", status: "pending" }),
        createMockExtractionJob({ id: "job-2", status: "processing" })
      ];
      vi.mocked(adapter.get).mockResolvedValue(mockJobs);

      const result = await repository.getAll();

      expect(adapter.get).toHaveBeenCalledWith("/extraction-jobs", undefined);
      expect(result).toEqual(mockJobs);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.extractionJobs["job-1"]).toEqual(mockJobs[0]);
      expect(state.entities.extractionJobs["job-2"]).toEqual(mockJobs[1]);
    });

    it("should pass filters to adapter", async () => {
      vi.mocked(adapter.get).mockResolvedValue([]);

      await repository.getAll({ status: "completed" });

      expect(adapter.get).toHaveBeenCalledWith("/extraction-jobs", {
        status: "completed"
      });
    });
  });

  describe("create", () => {
    it("should create extraction job and hydrate store", async () => {
      const newJobData = {
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
        compiledJsonSchema: null,
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const createdJob = createMockExtractionJob({
        id: "job-new",
        ...newJobData
      });
      vi.mocked(adapter.post).mockResolvedValue(createdJob);

      const result = await repository.create(newJobData);

      expect(adapter.post).toHaveBeenCalledWith("/extraction-jobs", newJobData);
      expect(result).toEqual(createdJob);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.extractionJobs["job-new"]).toEqual(createdJob);
    });
  });

  describe("update", () => {
    it("should update extraction job and hydrate store", async () => {
      const updates = { status: "processing", progressPercentage: 50 };
      const updatedJob = createMockExtractionJob({ ...updates });
      vi.mocked(adapter.patch).mockResolvedValue(updatedJob);

      const result = await repository.update("job-1", updates);

      expect(adapter.patch).toHaveBeenCalledWith(
        "/extraction-jobs/job-1",
        updates
      );
      expect(result).toEqual(updatedJob);

      // Verify store was hydrated
      const state = store.getState();
      expect(state.entities.extractionJobs["job-1"]).toEqual(updatedJob);
    });
  });

  describe("delete", () => {
    it("should delete extraction job and remove from store", async () => {
      // First add a job to the store
      const mockJob = createMockExtractionJob();
      store.dispatch({
        type: "entities/setExtractionJob",
        payload: mockJob
      });

      vi.mocked(adapter.delete).mockResolvedValue(undefined);

      await repository.delete("job-1");

      expect(adapter.delete).toHaveBeenCalledWith("/extraction-jobs/job-1");

      // Verify job was removed from store
      const state = store.getState();
      expect(state.entities.extractionJobs["job-1"]).toBeUndefined();
    });
  });

  describe("updateOptimistic", () => {
    it("should perform optimistic update and sync with backend", async () => {
      // First add a job to the store
      const originalJob = createMockExtractionJob({ status: "pending" });
      store.dispatch({
        type: "entities/setExtractionJob",
        payload: originalJob
      });

      const updates = { status: "processing" };
      const serverJob = createMockExtractionJob({
        status: "processing",
        progressPercentage: 10
      });
      vi.mocked(adapter.patch).mockResolvedValue(serverJob);

      const result = await repository.updateOptimistic("job-1", updates);

      expect(result).toEqual(serverJob);

      // Verify final state matches server response
      const state = store.getState();
      expect(state.entities.extractionJobs["job-1"]).toEqual(serverJob);
    });

    it("should rollback on failure", async () => {
      // First add a job to the store
      const originalJob = createMockExtractionJob({ status: "pending" });
      store.dispatch({
        type: "entities/setExtractionJob",
        payload: originalJob
      });

      const updates = { status: "processing" };
      vi.mocked(adapter.patch).mockRejectedValue(new Error("Update failed"));

      await expect(
        repository.updateOptimistic("job-1", updates)
      ).rejects.toThrow("Update failed");

      // Verify state was rolled back to original
      const state = store.getState();
      expect(state.entities.extractionJobs["job-1"]).toEqual(originalJob);
    });
  });

  describe("IExtractionJobRepository interface methods", () => {
    describe("getExtractionJobById", () => {
      it("should delegate to getById", async () => {
        const mockJob = createMockExtractionJob();
        vi.mocked(adapter.get).mockResolvedValue(mockJob);

        const result = await repository.getExtractionJobById("job-1");

        expect(adapter.get).toHaveBeenCalledWith("/extraction-jobs/job-1");
        expect(result).toEqual(mockJob);
      });
    });

    describe("getExtractionJobsByProject", () => {
      it("should fetch jobs filtered by project", async () => {
        const mockJobs = [
          createMockExtractionJob({ id: "job-1" }),
          createMockExtractionJob({ id: "job-2" })
        ];
        vi.mocked(adapter.get).mockResolvedValue({
          extractionJobs: mockJobs
        });

        const result = await repository.getExtractionJobsByProject("project-1");

        expect(adapter.get).toHaveBeenCalledWith(
          "/extraction/project/project-1/jobs"
        );
        expect(result).toEqual(mockJobs);
      });
    });

    describe("getExtractionJobsByDataLayer", () => {
      it("should fetch jobs filtered by data layer", async () => {
        const mockJobs = [createMockExtractionJob()];
        vi.mocked(adapter.get).mockResolvedValue(mockJobs);

        const result = await repository.getExtractionJobsByDataLayer("layer-1");

        expect(adapter.get).toHaveBeenCalledWith("/extraction-jobs", {
          dataLayerId: "layer-1"
        });
        expect(result).toEqual(mockJobs);
      });
    });

    describe("createExtractionJob", () => {
      it("should create job with DTO transformation", async () => {
        const createData = {
          organizationId: "org-1",
          initiatedBy: "user-1",
          schemaId: "schema-1",
          jobType: "material_extraction" as const,
          config: { option: "value" }
        };
        const createdJob = createMockExtractionJob({
          id: "job-new",
          jobType: "material_extraction",
          config: { option: "value" }
        });
        vi.mocked(adapter.post).mockResolvedValue(createdJob);

        const result = await repository.createExtractionJob(createData);

        expect(adapter.post).toHaveBeenCalledWith(
          "/extraction-jobs",
          expect.objectContaining({
            organizationId: "org-1",
            initiatedBy: "user-1",
            schemaId: "schema-1",
            jobType: "material_extraction",
            status: "pending",
            progressPercentage: 0,
            config: { option: "value" }
          })
        );
        expect(result).toEqual(createdJob);
      });
    });

    describe("updateExtractionJobStatus", () => {
      it("should update job status with progress", async () => {
        const mockJob = createMockExtractionJob({ status: "pending" });
        store.dispatch({
          type: "entities/setExtractionJob",
          payload: mockJob
        });

        const updatedJob = createMockExtractionJob({
          status: "processing",
          progressPercentage: 50
        });
        vi.mocked(adapter.patch).mockResolvedValue(updatedJob);

        const result = await repository.updateExtractionJobStatus(
          "job-1",
          "running",
          50
        );

        expect(adapter.patch).toHaveBeenCalledWith(
          "/extraction-jobs/job-1",
          expect.objectContaining({
            status: "running",
            progressPercentage: 50
          })
        );
        expect(result).toEqual(updatedJob);
      });

      it("should set startedAt when status changes to processing", async () => {
        const mockJob = createMockExtractionJob({
          status: "pending",
          startedAt: null
        });
        store.dispatch({
          type: "entities/setExtractionJob",
          payload: mockJob
        });

        const updatedJob = createMockExtractionJob({
          status: "running",
          startedAt: new Date()
        });
        vi.mocked(adapter.patch).mockResolvedValue(updatedJob);

        await repository.updateExtractionJobStatus("job-1", "running");

        expect(adapter.patch).toHaveBeenCalledWith(
          "/extraction-jobs/job-1",
          expect.objectContaining({
            status: "running",
            startedAt: expect.any(Date)
          })
        );
      });

      it("should set completedAt and progress to 100 when status is completed", async () => {
        const mockJob = createMockExtractionJob({ status: "processing" });
        store.dispatch({
          type: "entities/setExtractionJob",
          payload: mockJob
        });

        const updatedJob = createMockExtractionJob({
          status: "completed",
          progressPercentage: 100,
          completedAt: new Date()
        });
        vi.mocked(adapter.patch).mockResolvedValue(updatedJob);

        await repository.updateExtractionJobStatus("job-1", "completed");

        expect(adapter.patch).toHaveBeenCalledWith(
          "/extraction-jobs/job-1",
          expect.objectContaining({
            status: "completed",
            completedAt: expect.any(Date),
            progressPercentage: 100
          })
        );
      });

      it("should include error message when status is failed", async () => {
        const mockJob = createMockExtractionJob({ status: "processing" });
        store.dispatch({
          type: "entities/setExtractionJob",
          payload: mockJob
        });

        const updatedJob = createMockExtractionJob({
          status: "failed",
          errorMessage: "Processing error",
          completedAt: new Date()
        });
        vi.mocked(adapter.patch).mockResolvedValue(updatedJob);

        await repository.updateExtractionJobStatus(
          "job-1",
          "failed",
          undefined,
          "Processing error"
        );

        expect(adapter.patch).toHaveBeenCalledWith(
          "/extraction-jobs/job-1",
          expect.objectContaining({
            status: "failed",
            errorMessage: "Processing error",
            completedAt: expect.any(Date)
          })
        );
      });
    });

    describe("appendJobLog", () => {
      it("should append log entry to job", async () => {
        const logEntry = {
          timestamp: new Date(),
          message: "Processing started"
        };
        const updatedJob = createMockExtractionJob({
          logs: [logEntry]
        });
        vi.mocked(adapter.post).mockResolvedValue(undefined);
        vi.mocked(adapter.get).mockResolvedValue(updatedJob);

        await repository.appendJobLog("job-1", logEntry);

        expect(adapter.post).toHaveBeenCalledWith(
          "/extraction-jobs/job-1/logs",
          {
            logEntry
          }
        );
      });
    });

    describe("addDataLayerToJob", () => {
      it("should add data layer to job", async () => {
        vi.mocked(adapter.post).mockResolvedValue(undefined);

        await repository.addDataLayerToJob("job-1", "layer-1", 1);

        expect(adapter.post).toHaveBeenCalledWith(
          "/extraction-jobs/job-1/data-layers",
          {
            dataLayerId: "layer-1",
            processingOrder: 1
          }
        );
      });
    });

    describe("updateExtractionJobDataLayerStatus", () => {
      it("should update data layer status", async () => {
        vi.mocked(adapter.patch).mockResolvedValue(undefined);

        await repository.updateExtractionJobDataLayerStatus(
          "job-1",
          "layer-1",
          "completed"
        );

        expect(adapter.patch).toHaveBeenCalledWith(
          "/extraction-jobs/job-1/data-layers/layer-1",
          { status: "completed" }
        );
      });
    });

    describe("getExtractionJobDataLayers", () => {
      it("should fetch data layers for job", async () => {
        const mockDataLayers = [
          { id: "layer-1", status: "completed" },
          { id: "layer-2", status: "pending" }
        ];
        vi.mocked(adapter.get).mockResolvedValue(mockDataLayers);

        const result = await repository.getExtractionJobDataLayers("job-1");

        expect(adapter.get).toHaveBeenCalledWith(
          "/extraction-jobs/job-1/data-layers"
        );
        expect(result).toEqual(mockDataLayers);
      });
    });

    describe("deleteExtractionJob", () => {
      it("should delegate to delete", async () => {
        const mockJob = createMockExtractionJob();
        store.dispatch({
          type: "entities/setExtractionJob",
          payload: mockJob
        });

        vi.mocked(adapter.delete).mockResolvedValue(undefined);

        await repository.deleteExtractionJob("job-1");

        expect(adapter.delete).toHaveBeenCalledWith("/extraction-jobs/job-1");

        const state = store.getState();
        expect(state.entities.extractionJobs["job-1"]).toBeUndefined();
      });
    });

    describe("searchExtractionResults", () => {
      it("should search extraction results", async () => {
        const mockResults = [{ id: "result-1" }, { id: "result-2" }];
        vi.mocked(adapter.get).mockResolvedValue(mockResults);

        const result = await repository.searchExtractionResults(
          "job-1",
          "test query"
        );

        expect(adapter.get).toHaveBeenCalledWith(
          "/extraction-jobs/job-1/results/search",
          { query: "test query" }
        );
        expect(result).toEqual(mockResults);
      });
    });

    describe("getHighConfidenceExtractions", () => {
      it("should fetch high-confidence extractions", async () => {
        const mockResults = [{ id: "result-1", confidenceScore: 0.95 }];
        vi.mocked(adapter.get).mockResolvedValue(mockResults);

        const result = await repository.getHighConfidenceExtractions(
          "job-1",
          0.9
        );

        expect(adapter.get).toHaveBeenCalledWith(
          "/extraction-jobs/job-1/results/high-confidence",
          { threshold: 0.9 }
        );
        expect(result).toEqual(mockResults);
      });
    });

    describe("getExtractionJobsByConfidenceScore", () => {
      it("should fetch jobs filtered by confidence score", async () => {
        const mockJobs = [createMockExtractionJob({ id: "job-1" })];
        vi.mocked(adapter.get).mockResolvedValue(mockJobs);

        const result = await repository.getExtractionJobsByConfidenceScore(0.8);

        expect(adapter.get).toHaveBeenCalledWith("/extraction-jobs", {
          minConfidence: 0.8
        });
        expect(result).toEqual(mockJobs);
      });
    });

    describe("getExtractionJobsByMaterialType", () => {
      it("should fetch jobs filtered by material type", async () => {
        const mockJobs = [createMockExtractionJob({ id: "job-1" })];
        vi.mocked(adapter.get).mockResolvedValue(mockJobs);

        const result =
          await repository.getExtractionJobsByMaterialType("steel");

        expect(adapter.get).toHaveBeenCalledWith("/extraction-jobs", {
          materialType: "steel"
        });
        expect(result).toEqual(mockJobs);
      });
    });
  });
});
