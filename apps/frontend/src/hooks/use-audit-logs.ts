import type {
  AuditLog,
  AuditLogFilters,
  AuditLogsResponse
} from "@packages/types";
import { TABLE_NAMES } from "@packages/types";
import { useQuery } from "@tanstack/react-query";
import { getCacheManager, REALTIME_CONFIGS } from "@/lib/cache-manager";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

// Re-export types for convenience
export type { AuditLog, AuditLogFilters };

/**
 * Hook to fetch audit logs for the current organization with realtime updates
 * Requires Admin role
 */
export function useAuditLogs(filters: AuditLogFilters = {}) {
  const cacheManager = getCacheManager();
  const queryParams = new URLSearchParams();

  // Add filters to query params
  if (filters.startDate) queryParams.append("startDate", filters.startDate);
  if (filters.endDate) queryParams.append("endDate", filters.endDate);
  if (filters.actorEmail) queryParams.append("actorEmail", filters.actorEmail);
  if (filters.targetTable)
    queryParams.append("targetTable", filters.targetTable);
  if (filters.action) queryParams.append("action", filters.action);
  if (filters.actorName) queryParams.append("actorName", filters.actorName);
  if (filters.limit) queryParams.append("limit", filters.limit.toString());
  if (filters.offset) queryParams.append("offset", filters.offset.toString());

  return useQuery({
    queryKey: ["auditLogs", filters],
    queryFn: async (): Promise<AuditLogsResponse> => {
      // Get auth headers with token
      const supabase = getSupabaseBrowser();
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const url = queryParams.toString()
        ? `/api/${TABLE_NAMES.AUDIT_LOG}/organization?${queryParams.toString()}`
        : `/api/${TABLE_NAMES.AUDIT_LOG}/organization`;

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || ""}${url}`,
        { headers }
      );

      if (!response.ok) {
        // Create an error object with status for the retry logic
        const error = new Error(
          `HTTP ${response.status}: ${response.statusText}`
        ) as Error & { response?: { status: number } };
        error.response = { status: response.status };
        throw error;
      }

      const data = await response.json();
      return data;
    },
    // Realtime polling configuration
    refetchInterval: cacheManager.getPollingInterval(
      REALTIME_CONFIGS.auditLogs.interval,
      REALTIME_CONFIGS.auditLogs.backgroundInterval
    ),
    refetchIntervalInBackground: false, // Use our custom background polling logic
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Preserve scroll position during realtime updates
    placeholderData: (previousData) => previousData,
    staleTime: 10_000, // 10 seconds - shorter than polling interval for fresh data
    gcTime: 10 * 60 * 1000, // 10 minutes - keep audit logs longer in cache
    retry: (failureCount, error: Error & { response?: { status: number } }) => {
      // Don't retry on 403 (likely role-based access issue)
      if (error?.response?.status === 403) {
        return false;
      }
      // Implement exponential backoff for network resilience
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000) // Exponential backoff up to 30s
  });
}

/**
 * Hook to get default date range for audit logs (last week)
 */
export function useDefaultAuditLogDateRange() {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  return {
    startDate: oneWeekAgo.toISOString().split("T")[0], // YYYY-MM-DD format
    endDate: now.toISOString().split("T")[0]
  };
}
