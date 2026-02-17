/**
 * useAppDataOrchestrator Hook
 *
 * Centralized orchestration of all application data initialization and synchronization.
 * Manages the complete data flow:
 * 1. Fetch clients once on app mount (Layer 1 defense: useRef guard)
 * 2. Refetch projects when client selection changes
 * 3. Subscribe to WebSocket hot data when needed
 *
 * SAFE: Uses Layer 1 defense (useRef guard) + empty/minimal dependencies
 * Should be called ONCE at CoreProvider level, NOT in components
 *
 * Requirements: 9.1, 9.2, 12.1, 12.2
 */

import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { RootState } from "../store";
import { setSelectedClientId } from "../store";
import { usePersistence } from "./use-persistence";

/**
 * Orchestrates all initial data loading and syncing
 *
 * SAFE PATTERN - Layer 1 Defense:
 * - Uses useRef to guard against double-fetches
 * - Empty dependency array on first effect (runs once only)
 * - Minimal dependencies on subsequent effects
 *
 * @example
 * // In CoreProvider or RootLayout
 * export function CoreProvider({ children }) {
 *   useAppDataOrchestrator(); // Call once at app root
 *   return children;
 * }
 */
export function useAppDataOrchestrator(): void {
  const persistence = usePersistence();
  const dispatch = useDispatch();
  const selectedClientId = useSelector(
    (state: RootState) => state.ui.selections.selectedClientId
  );
  const persistedClientId = useSelector(
    (state: RootState) => state.preferences.selectedClientId
  );

  // ============================================================
  // PHASE 0: Restore persisted client selection (once on mount)
  // ============================================================
  // Load persisted client ID from preferences into UI state
  const restoreClientRef = useRef(false);
  useEffect(() => {
    if (restoreClientRef.current) return;
    restoreClientRef.current = true;

    // If we have a persisted client ID but no UI selection, restore it
    if (persistedClientId && !selectedClientId) {
      dispatch(setSelectedClientId(persistedClientId));
    }
  }, [persistedClientId, selectedClientId, dispatch]); // Run once, but need values for comparison

  // ============================================================
  // PHASE 1: Fetch clients (once on mount)
  // ============================================================
  // Layer 1 Defense: useRef guard prevents multiple fetches
  const clientsInitRef = useRef(false);

  useEffect(() => {
    // Guard: prevent multiple initializations
    if (clientsInitRef.current) return;
    clientsInitRef.current = true;

    const fetchClients = async () => {
      try {
        // Repository hydrates store via Redux dispatch
        await persistence.clients.getAll();
      } catch (error) {
        console.error("[AppDataOrchestrator] Failed to fetch clients:", error);
      }
    };

    void fetchClients();
  }, []); // Layer 1 Defense: Empty deps = run once only

  // ============================================================
  // PHASE 2: Fetch projects (when client selected)
  // ============================================================
  // Layer 1 Defense: Only depends on meaningful value change
  const lastClientIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedClientId) return;

    // Only fetch if client changed
    if (lastClientIdRef.current === selectedClientId) return;
    lastClientIdRef.current = selectedClientId;

    const fetchProjects = async () => {
      try {
        // Repository hydrates store via Redux dispatch
        // Fetch both active and archived projects to populate the store
        // Backend has separate endpoints for active and archived projects
        await Promise.all([
          // Fetch active projects (via main endpoint)
          persistence.projects.getAll({ clientId: selectedClientId }),
          // Fetch archived projects (via dedicated archived endpoint)
          persistence.projects.getArchivedProjects(selectedClientId)
        ]);
      } catch (error) {
        console.error("[AppDataOrchestrator] Failed to fetch projects:", error);
      }
    };

    void fetchProjects();
  }, [selectedClientId, persistence]); // Only trigger when client changes

  // ============================================================
  // PHASE 3: Subscribe to hot data WebSocket (when client selected)
  // ============================================================
  // Layer 1 Defense: Subscribe to WebSocket channels for real-time updates
  // Note: Extraction jobs are fetched on-demand when viewing specific projects
  // not globally, as there's no endpoint to fetch all extraction jobs
  useEffect(() => {
    if (!selectedClientId) return;

    const subscribeToHotData = () => {
      try {
        persistence.projects.subscribe?.();
        persistence.dataLayers.subscribe?.();
        persistence.extractionSchemas.subscribe?.();
        persistence.extractionJobs.subscribe?.();
        persistence.extractionResults.subscribe?.();
      } catch (error) {
        console.error(
          "[AppDataOrchestrator] Failed to subscribe to hot data:",
          error
        );
      }
    };

    subscribeToHotData();

    return () => {
      try {
        persistence.projects.unsubscribe?.();
        persistence.dataLayers.unsubscribe?.();
        persistence.extractionSchemas.unsubscribe?.();
        persistence.extractionJobs.unsubscribe?.();
        persistence.extractionResults.unsubscribe?.();
      } catch (error) {
        console.error("[AppDataOrchestrator] Failed to unsubscribe:", error);
      }
    };
  }, [selectedClientId]);
}
