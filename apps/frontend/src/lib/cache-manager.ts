"use client";

import { QueryClient } from "@tanstack/react-query";

/**
 * Realtime configuration for different data types
 */
export const REALTIME_CONFIGS = {
  clients: {
    interval: 15_000, // 15 seconds
    backgroundInterval: 60_000, // 1 minute when tab inactive
    optimistic: true
  },
  projects: {
    interval: 3_000, // 3 seconds (already implemented)
    backgroundInterval: 10_000, // 10 seconds when tab inactive
    optimistic: true
  },
  dashboard: {
    interval: 15_000, // 15 seconds
    backgroundInterval: 60_000, // 1 minute when tab inactive
    optimistic: false // Dashboard is read-only
  },
  auditLogs: {
    interval: 30_000, // 30 seconds
    backgroundInterval: 60_000, // 1 minute when tab inactive
    optimistic: false // Audit logs are read-only
  },
  extraction: {
    interval: 3_000, // 3 seconds (already implemented)
    optimistic: true
  }
} as const;

/**
 * Cache Manager for handling authentication and organization-aware cache invalidation
 */
export class CacheManager {
  private queryClient: QueryClient;
  private currentUserId: string | null = null;
  private currentOrgId: string | null = null;

  constructor(queryClient: QueryClient) {
    this.queryClient = queryClient;
  }

  /**
   * Set current user and organization context
   */
  setContext(userId: string | null, organizationId: string | null) {
    const userChanged = this.currentUserId !== userId;
    const orgChanged = this.currentOrgId !== organizationId;

    // If user changed, clear all cache
    if (userChanged && this.currentUserId !== null) {
      console.log(
        "[cache-manager] setContext - User changed, clearing all cache"
      );
      this.clearAllCache();
    }
    // If only organization changed, clear org-specific data
    else if (orgChanged && this.currentOrgId !== null) {
      console.log(
        "[cache-manager] setContext - Organization changed, clearing org-specific cache"
      );
      this.clearOrganizationCache(this.currentOrgId);
    }

    this.currentUserId = userId;
    this.currentOrgId = organizationId;
  }

  /**
   * Clear all cache (used on login/logout)
   */
  clearAllCache() {
    console.log(
      "[cache-manager] clearAllCache - Clearing all React Query cache"
    );
    this.queryClient.clear();
  }

  /**
   * Clear organization-specific cache
   */
  clearOrganizationCache(organizationId?: string | null) {
    const orgId = organizationId || this.currentOrgId;
    if (!orgId) return;

    console.log(
      `[cache-manager] clearOrganizationCache - Clearing cache for organization: ${orgId}`
    );

    // Remove all queries that might contain org-specific data
    this.queryClient.removeQueries({ queryKey: ["clients"] });
    this.queryClient.removeQueries({ queryKey: ["projects"] });
    this.queryClient.removeQueries({ queryKey: ["dashboard-clients"] });
    this.queryClient.removeQueries({ queryKey: ["dashboard-projects"] });
    this.queryClient.removeQueries({ queryKey: ["project-data"] });
    this.queryClient.removeQueries({ queryKey: ["extraction-results"] });
    this.queryClient.removeQueries({ queryKey: ["dashboard-metrics"] });
  }

  /**
   * Clear user-specific cache (preserving public data)
   */
  clearUserCache() {
    console.log(
      "[cache-manager] clearUserCache - Clearing user-specific cache"
    );

    // Clear user-specific queries
    this.queryClient.removeQueries({ queryKey: ["user"] });
    this.queryClient.removeQueries({ queryKey: ["user-profile"] });
    this.queryClient.removeQueries({ queryKey: ["user-settings"] });

    // Clear organization data since it's user-dependent
    this.clearOrganizationCache();
  }

  /**
   * Get appropriate polling interval based on tab visibility
   */
  getPollingInterval(
    baseInterval: number,
    backgroundInterval?: number
  ): number {
    const isVisible = !document.hidden;
    return isVisible ? baseInterval : backgroundInterval || baseInterval * 4;
  }

  /**
   * Enhanced invalidation with double refresh pattern
   */
  invalidateWithRefresh(queryKey: readonly unknown[]): void {
    console.log(
      `[cache-manager] invalidateWithRefresh - Double refresh for queryKey:`,
      queryKey
    );

    this.queryClient.invalidateQueries({ queryKey });

    // Double refresh pattern like extraction results
    setTimeout(() => {
      this.queryClient.invalidateQueries({ queryKey });
    }, 500);
  }

  /**
   * Invalidate cache after mutations
   */
  invalidateAfterMutation(
    type: "client" | "project" | "user" | "extraction" | "supplier",
    action: "create" | "update" | "delete" | "complete" | "fail",
    id?: string
  ) {
    console.log(
      `[cache-manager] invalidateCache - ${action} ${type}${id ? ` (${id})` : ""}`
    );

    switch (type) {
      case "supplier":
        // Invalidate suppliers list
        this.queryClient.invalidateQueries({ queryKey: ["suppliers"] });
        this.queryClient.invalidateQueries({
          queryKey: ["dashboard-suppliers"]
        });

        if (id) {
          // Invalidate specific supplier
          this.queryClient.invalidateQueries({ queryKey: ["supplier", id] });
        }

        if (action === "delete") {
          // Remove deleted supplier from cache
          this.queryClient.removeQueries({ queryKey: ["supplier", id] });
        }

        break;

      case "client":
        // Invalidate clients list
        this.queryClient.invalidateQueries({ queryKey: ["clients"] });
        this.queryClient.invalidateQueries({ queryKey: ["dashboard-clients"] });

        if (id) {
          // Invalidate specific client
          this.queryClient.invalidateQueries({ queryKey: ["client", id] });

          if (action === "delete") {
            // Remove deleted client from cache
            this.queryClient.removeQueries({ queryKey: ["client", id] });
            // Also invalidate projects for this client
            this.queryClient.invalidateQueries({ queryKey: ["projects", id] });
          }
        }
        break;

      case "project":
        // Invalidate projects lists
        this.queryClient.invalidateQueries({ queryKey: ["projects"] });
        this.queryClient.invalidateQueries({
          queryKey: ["dashboard-projects"]
        });

        if (id) {
          // Invalidate specific project
          this.queryClient.invalidateQueries({ queryKey: ["project", id] });
          this.queryClient.invalidateQueries({
            queryKey: ["project-data", id]
          });

          if (action === "delete") {
            // Remove deleted project from cache
            this.queryClient.removeQueries({ queryKey: ["project", id] });
            this.queryClient.removeQueries({ queryKey: ["project-data", id] });
          }
        }
        break;

      case "user":
        this.clearUserCache();
        break;

      case "extraction":
        if (id) {
          // Invalidate specific extraction job and results
          this.queryClient.invalidateQueries({
            queryKey: ["extraction:job", { jobId: id }]
          });
          this.queryClient.invalidateQueries({
            queryKey: ["extraction:results", { jobId: id }]
          });

          if (action === "complete") {
            // When extraction completes, use double refresh pattern
            this.invalidateWithRefresh(["extraction:results", { jobId: id }]);

            // Also invalidate project data to show updated extraction jobs
            this.queryClient.invalidateQueries({ queryKey: ["projects:data"] });
          }
        }

        // Always invalidate project lists when extraction jobs change
        this.queryClient.invalidateQueries({ queryKey: ["projects:list"] });
        break;
    }

    // Always invalidate dashboard metrics after any mutation
    this.queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });

    // Add delayed refresh for critical data consistency
    if (type === "client" || type === "project") {
      setTimeout(() => {
        console.log(
          `[cache-manager] invalidateAfterMutation - Delayed refresh for ${type} ${action}`
        );
        this.queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
        this.queryClient.invalidateQueries({ queryKey: ["clients"] });
        this.queryClient.invalidateQueries({ queryKey: ["projects"] });
      }, 750);
    }
  }

  /**
   * Refresh all current data (soft refresh)
   */
  refreshCurrentData() {
    console.log("[cache-manager] refreshCurrentData - Refreshing current data");

    // Invalidate but don't remove - will trigger background refetch
    this.queryClient.invalidateQueries({ queryKey: ["clients"] });
    this.queryClient.invalidateQueries({ queryKey: ["projects"] });
    this.queryClient.invalidateQueries({ queryKey: ["dashboard-clients"] });
    this.queryClient.invalidateQueries({ queryKey: ["dashboard-projects"] });
    this.queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
    this.queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    this.queryClient.invalidateQueries({ queryKey: ["dashboard-suppliers"] });
    this.queryClient.invalidateQueries({ queryKey: ["suppliers:list"] });
  }

  /**
   * Handle authentication events
   */
  onLogin(userId: string, organizationId: string | null) {
    console.log(
      "[cache-manager] onUserLogin - User logged in, clearing stale cache"
    );
    this.clearAllCache();
    this.setContext(userId, organizationId);
  }

  onLogout() {
    console.log(
      "[cache-manager] onUserLogout - User logged out, clearing all cache"
    );
    this.clearAllCache();
    this.setContext(null, null);
  }

  onOrganizationChange(newOrgId: string | null) {
    console.log(
      `[cache-manager] onOrganizationChange - Organization changed to: ${newOrgId}`
    );
    this.setContext(this.currentUserId, newOrgId);
  }

  /**
   * Get cache statistics for debugging
   */
  getCacheStats() {
    const cache = this.queryClient.getQueryCache();
    const queries = cache.getAll();

    const stats = {
      totalQueries: queries.length,
      staleQueries: queries.filter((q) => q.isStale()).length,
      fetchingQueries: queries.filter((q) => q.state.fetchStatus === "fetching")
        .length,
      errorQueries: queries.filter((q) => q.state.status === "error").length,
      queryKeys: queries.map((q) => q.queryKey)
    };

    console.log("[cache-manager] getCacheStats - Cache Statistics:", stats);
    return stats;
  }

  /**
   * Prefetch critical data for better UX
   */
  async prefetchCriticalData() {
    if (!this.currentUserId) return;

    console.log(
      "[cache-manager] prefetchCriticalData - Prefetching critical data"
    );

    try {
      // Prefetch clients and projects in parallel
      await Promise.all([
        this.queryClient.prefetchQuery({
          queryKey: ["clients", 1, 50],
          staleTime: 2 * 60 * 1000
        }),
        this.queryClient.prefetchQuery({
          queryKey: ["projects", null, 1, 50],
          staleTime: 1 * 60 * 1000
        })
      ]);
    } catch (error) {
      console.warn(
        "[cache-manager] prefetchCriticalData - Failed to prefetch critical data:",
        error
      );
    }
  }
}

// Singleton instance
let cacheManager: CacheManager | null = null;

export function getCacheManager(queryClient?: QueryClient): CacheManager {
  if (!cacheManager && queryClient) {
    cacheManager = new CacheManager(queryClient);
  }

  if (!cacheManager) {
    throw new Error(
      "CacheManager not initialized. Call getCacheManager with QueryClient first."
    );
  }

  return cacheManager;
}
