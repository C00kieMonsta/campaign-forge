import { useCallback, useEffect, useRef, useState } from "react";
import { usePersistence } from "@packages/core-client";
import type { NormalizedExtractionSchema } from "@packages/types";

interface UseExtractionPageDataProps {
  jobId: string;
}

interface UseExtractionPageDataResult {
  schema: NormalizedExtractionSchema | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useExtractionPageData({
  jobId
}: UseExtractionPageDataProps): UseExtractionPageDataResult {
  const persistence = usePersistence();
  const [schema, setSchema] = useState<NormalizedExtractionSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchInitRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!jobId) return;

    try {
      setLoading(true);
      setError(null);

      const response =
        await persistence.extractionResults.getExtractionResultsByJobWithPagination(
          jobId,
          1,
          10000
        );

      if (response.schema) {
        setSchema(response.schema as NormalizedExtractionSchema);
      }

      try {
        await persistence.suppliers.getJobSupplierMatches(jobId);
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: "warn",
            action: "fetchSupplierMatches",
            jobId,
            error: err instanceof Error ? err.message : "Unknown error"
          })
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [jobId, persistence.extractionResults, persistence.suppliers]);

  // Initial fetch
  useEffect(() => {
    if (!jobId || fetchInitRef.current) return;
    fetchInitRef.current = true;
    fetchData();
  }, [jobId, fetchData]);

  const refetch = useCallback(async () => {
    fetchInitRef.current = false;
    await fetchData();
  }, [fetchData]);

  return {
    schema,
    loading,
    error,
    refetch
  };
}
