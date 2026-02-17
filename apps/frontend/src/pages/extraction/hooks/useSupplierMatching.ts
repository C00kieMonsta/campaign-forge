import { useCallback, useEffect, useMemo, useState } from "react";
import {
  usePersistence,
  useSupplierMatches,
  useSuppliers
} from "@packages/core-client";
import type { ExtractionResult, Supplier } from "@packages/types";

interface SupplierMatch {
  id: string;
  supplierId: string;
  confidenceScore: number | null;
  matchReason: string | null;
  isSelected: boolean;
  supplier: Supplier | null;
}

interface UseSupplierMatchingProps {
  jobId: string;
  results: ExtractionResult[];
}

interface UseSupplierMatchingResult {
  hasSuppliers: boolean;
  isLoadingSuppliers: boolean;
  isMatching: boolean;
  resultsWithMatches: Array<{ id: string; matches: SupplierMatch[] }>;
  matchSuppliers: () => Promise<void>;
  selectSupplier: (resultId: string, supplierId: string) => Promise<void>;
}

export function useSupplierMatching({
  jobId,
  results
}: UseSupplierMatchingProps): UseSupplierMatchingResult {
  const persistence = usePersistence();
  const supplierMatches = useSupplierMatches();
  const suppliers = useSuppliers();
  const [hasSuppliers, setHasSuppliers] = useState(false);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);
  const [isMatching, setIsMatching] = useState(false);

  // Check suppliers on mount
  useEffect(() => {
    const checkSuppliers = async () => {
      try {
        setIsLoadingSuppliers(true);
        const suppliersList = await persistence.suppliers.getAllSuppliers();
        setHasSuppliers((suppliersList?.length || 0) > 0);
      } catch (error) {
        setHasSuppliers(false);
        console.warn(
          JSON.stringify({
            level: "warn",
            action: "checkSuppliers",
            error: error instanceof Error ? error.message : "Unknown error"
          })
        );
      } finally {
        setIsLoadingSuppliers(false);
      }
    };

    checkSuppliers();
  }, [persistence.suppliers]);

  // Subscribe to supplier matches updates
  useEffect(() => {
    if (!jobId) return;

    persistence.suppliers.subscribeSupplierMatches?.();

    return () => {
      persistence.suppliers.unsubscribeSupplierMatches?.();
    };
  }, [jobId, persistence.suppliers]);

  // Build results with matches
  const resultsWithMatches = useMemo(() => {
    if (!results || !supplierMatches || !suppliers) {
      return [];
    }

    const suppliersMap = new Map<string, Supplier>();
    suppliers.forEach((supplier) => {
      suppliersMap.set(supplier.id, supplier);
    });

    return results.map((result) => {
      const matchesForResult = supplierMatches.filter(
        (match) => match.extractionResultId === result.id
      );

      const matches = matchesForResult
        .map((match) => {
          const supplier = suppliersMap.get(match.supplierId);
          return {
            id: match.id,
            supplierId: match.supplierId,
            confidenceScore: match.confidenceScore,
            matchReason: match.matchReason,
            isSelected: match.isSelected,
            supplier: supplier || null
          };
        })
        .filter((match) => match.supplier !== null);

      return {
        id: result.id,
        matches
      };
    });
  }, [results, supplierMatches, suppliers]);

  const matchSuppliers = useCallback(async () => {
    try {
      setIsMatching(true);
      await persistence.suppliers.matchSuppliers(jobId);

      try {
        await persistence.suppliers.getJobSupplierMatches(jobId);
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: "warn",
            action: "refetchSupplierMatchesAfterMatching",
            jobId,
            error: err instanceof Error ? err.message : "Unknown error"
          })
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "matchSuppliers",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setIsMatching(false);
    }
  }, [jobId, persistence.suppliers]);

  const selectSupplier = useCallback(
    async (resultId: string, supplierId: string): Promise<void> => {
      await persistence.suppliers.selectSupplier(resultId, supplierId);
    },
    [persistence.suppliers]
  );

  return {
    hasSuppliers,
    isLoadingSuppliers,
    isMatching,
    resultsWithMatches,
    matchSuppliers,
    selectSupplier
  };
}
