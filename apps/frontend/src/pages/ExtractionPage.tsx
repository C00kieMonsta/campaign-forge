import { useCallback, useMemo, useState } from "react";
import { useExtractionResultRepository } from "@packages/core-client";
import type {
  JsonSchemaDefinition,
  SchemaProperty,
  UpdateExtractionResultRequest
} from "@packages/types";
import { jsonSchemaToSchemaProperties } from "@packages/utils";
import { AlertCircle } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { FlexibleExtractionResult } from "@/components/extraction/ExtractionRow";
import {
  ExportCSVDialog,
  ExtractionPageContent,
  ExtractionResultsToolbar,
  ManualEntryModal
} from "./extraction/_components";
import { useExtractionPageData, useSupplierMatching } from "./extraction/hooks";

/**
 * Extraction Results Page
 *
 * View and manage extraction job results with:
 * - Real-time result viewing and editing
 * - Bulk operations (delete, merge)
 * - CSV export with field selection
 * - Supplier matching
 * - Manual entry creation
 */
export default function ExtractionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("jobId") || "";
  const jobName = searchParams.get("jobName") || "Unknown Job";
  const projectId = searchParams.get("projectId") || "";

  // Store-first data hooks
  const {
    results,
    stats,
    updateResult: updateResultFromHook,
    updateResultStatus,
    createManualResult,
    deleteResults: deleteResultsFromHook
  } = useExtractionResultRepository(jobId);

  // Page data
  const { schema, loading, error, refetch } = useExtractionPageData({ jobId });

  // Supplier matching
  const {
    hasSuppliers,
    isLoadingSuppliers,
    isMatching,
    resultsWithMatches,
    matchSuppliers,
    selectSupplier
  } = useSupplierMatching({ jobId, results });

  // View mode: list or verification
  const [viewMode, setViewMode] = useState<"list" | "verification">("list");

  // Mutation loading states
  const [isCreatingManual, setIsCreatingManual] = useState(false);
  const [isDeletingResults, setIsDeletingResults] = useState(false);
  const [isMergingResults, setIsMergingResults] = useState(false);

  // Update result wrapper
  const updateResult = useCallback(
    async (
      resultId: string,
      updates: Record<string, unknown>
    ): Promise<boolean> => {
      try {
        await updateResultFromHook(
          resultId,
          updates as UpdateExtractionResultRequest
        );
        return true;
      } catch {
        return false;
      }
    },
    [updateResultFromHook]
  );

  // Delete results wrapper
  const deleteResults = useCallback(
    async (resultIds: string[]): Promise<void> => {
      setIsDeletingResults(true);
      try {
        await deleteResultsFromHook(resultIds);
      } finally {
        setIsDeletingResults(false);
      }
    },
    [deleteResultsFromHook]
  );

  // Merge results implementation
  const mergeResults = useCallback(
    async (
      primaryId: string,
      secondaryIds: string[],
      mergedData: Record<string, unknown>
    ): Promise<void> => {
      setIsMergingResults(true);
      try {
        await updateResult(primaryId, {
          verifiedData: mergedData,
          status: "accepted"
        });

        await deleteResults(secondaryIds);
      } finally {
        setIsMergingResults(false);
      }
    },
    [updateResult, deleteResults]
  );

  // Create manual result wrapper
  const createManualResultWithLoading = useCallback(
    async (data: {
      data: Record<string, unknown>;
      pageNumber?: number;
      locationInDoc?: string;
      originalSnippet?: string;
      notes?: string;
    }): Promise<void> => {
      setIsCreatingManual(true);
      try {
        await createManualResult({
          jobId,
          data: data.data,
          pageNumber: data.pageNumber,
          locationInDoc: data.locationInDoc,
          originalSnippet: data.originalSnippet,
          notes: data.notes
        });
      } finally {
        setIsCreatingManual(false);
      }
    },
    [jobId, createManualResult]
  );

  // Summary stats
  const summaryStats = useMemo(
    () => ({
      totalMaterials: stats.totalResults,
      acceptedCount: stats.acceptedCount,
      rejectedCount: stats.rejectedCount,
      editedCount: stats.editedCount,
      pendingCount: stats.pendingCount,
      averageConfidence: stats.averageConfidence
    }),
    [stats]
  );

  // Convert schema to properties
  const schemaProperties = useMemo((): SchemaProperty[] => {
    if (!schema?.definition) return [];
    try {
      return jsonSchemaToSchemaProperties(
        schema.definition as unknown as JsonSchemaDefinition
      );
    } catch {
      return [];
    }
  }, [schema]);

  // Build flexible extraction results with supplier matches
  const extractionResults = useMemo((): FlexibleExtractionResult[] => {
    if (!results) return [];

    const toRecord = (value: unknown): Record<string, unknown> => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
      return {};
    };

    const toNullableRecord = (
      value: unknown
    ): Record<string, unknown> | null => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
      return null;
    };

    const matchesMap = new Map<string, unknown[]>();
    resultsWithMatches.forEach((resultWithMatch) => {
      matchesMap.set(resultWithMatch.id, resultWithMatch.matches || []);
    });

    const sortedResults = [...results].sort(
      (a, b) => (a.pageNumber || 0) - (b.pageNumber || 0)
    );

    return sortedResults.map((result): FlexibleExtractionResult => {
      const rawExtraction = toRecord(result.rawExtraction);
      const verifiedData = toNullableRecord(result.verifiedData);
      const evidence = toRecord(result.evidence);
      const sourceText =
        typeof (evidence as { sourceText?: unknown }).sourceText === "string"
          ? ((evidence as { sourceText?: string }).sourceText as string)
          : undefined;

      const createdAtIso =
        result.createdAt instanceof Date
          ? result.createdAt.toISOString()
          : new Date(result.createdAt).toISOString();
      const updatedAtIso =
        result.updatedAt instanceof Date
          ? result.updatedAt.toISOString()
          : new Date(result.updatedAt).toISOString();

      const verifiedAtIso = result.verifiedAt
        ? new Date(result.verifiedAt).toISOString()
        : undefined;
      const editedAtIso = result.editedAt
        ? new Date(result.editedAt).toISOString()
        : undefined;

      return {
        id: result.id,
        extractionJobId: result.extractionJobId,
        rawExtraction,
        evidence,
        verifiedData,
        status: result.status,
        confidenceScore:
          result.confidenceScore === null ? undefined : result.confidenceScore,
        pageNumber: result.pageNumber ?? undefined,
        locationInDoc: (result as Record<string, unknown>).locationInDoc as
          | string
          | undefined,
        verifiedBy: result.verifiedBy ?? undefined,
        verifiedAt: verifiedAtIso,
        verificationNotes: result.verificationNotes ?? undefined,
        editedBy: result.editedBy ?? undefined,
        editedAt: editedAtIso,
        createdAt: createdAtIso,
        updatedAt: updatedAtIso,
        originalSnippet: sourceText || "No source text available",
        itemCode: (result as Record<string, unknown>).itemCode as
          | string
          | undefined,
        itemName: (result as Record<string, unknown>).itemName as
          | string
          | undefined,
        quantity: (result as Record<string, unknown>).quantity as
          | number
          | undefined,
        unit: (result as Record<string, unknown>).unit as string | undefined,
        supplierMatches: matchesMap.get(result.id) || []
      } as FlexibleExtractionResult;
    });
  }, [results, resultsWithMatches]);

  // UI state
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: string;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [matchFilter, setMatchFilter] = useState<
    "all" | "matched" | "unmatched"
  >("all");
  const [updatingSupplierForRow, setUpdatingSupplierForRow] = useState<
    string | null
  >(null);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filterProperty, setFilterProperty] = useState<string | null>(null);
  const [filterValue, setFilterValue] = useState("");
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);

  // Editing handlers
  const startEdit = (id: string, field: string, currentValue: string) => {
    setEditingCell({ id, field });
    setEditValue(currentValue);
  };

  const saveEdit = useCallback(async () => {
    if (!editingCell) return;
    const material = extractionResults.find((m) => m.id === editingCell.id);
    if (!material?.id) return;

    try {
      const updateData = {
        [editingCell.field]:
          editingCell.field === "quantity"
            ? parseFloat(editValue) || undefined
            : editValue
      };

      const success = await updateResult(material.id, updateData);
      if (!success) {
        alert("Failed to save changes. Please try again.");
        return;
      }

      setEditingCell(null);
      setEditValue("");
    } catch {
      alert("Failed to save changes. Please try again.");
    }
  }, [editingCell, editValue, extractionResults, updateResult]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  const handleStatusChange = useCallback(
    async (id: string, newStatus: "accepted" | "pending") => {
      try {
        const success = await updateResultStatus(id, newStatus);
        if (!success) {
          alert("Failed to update status. Please try again.");
        }
      } catch {
        alert("Failed to update status. Please try again.");
      }
    },
    [updateResultStatus]
  );

  const openExportDialog = useCallback(() => {
    setShowExportDialog(true);
  }, []);

  const handleSelectSupplier = useCallback(
    async (resultId: string, supplierId: string) => {
      setUpdatingSupplierForRow(resultId);
      try {
        await selectSupplier(resultId, supplierId);
      } catch {
        alert("Failed to select supplier. Please try again.");
      } finally {
        setUpdatingSupplierForRow(null);
      }
    },
    [selectSupplier]
  );

  const handleManualEntrySubmit = useCallback(
    async (formData: Record<string, unknown>) => {
      try {
        const pageNumber = formData.pageNumber
          ? parseInt(String(formData.pageNumber), 10)
          : 1;
        const locationInDoc = String(formData.locationInDoc || "Manual entry");
        const originalSnippet = String(
          formData.originalSnippet || "Manually entered"
        );

        const {
          pageNumber: _,
          locationInDoc: __,
          originalSnippet: ___,
          ...data
        } = formData;
        void _;
        void __;
        void ___;

        await createManualResultWithLoading({
          data,
          pageNumber,
          locationInDoc,
          originalSnippet,
          notes: "Manually created entry"
        });
        setShowManualEntryModal(false);
      } catch {
        throw new Error("Failed to create manual entry");
      }
    },
    [createManualResultWithLoading]
  );

  const handleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(id);
      } else {
        newSet.delete(id);
      }
      return newSet;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    try {
      await deleteResults(Array.from(selectedIds));
      setSelectedIds(new Set());
    } catch {
      alert("Failed to delete results. Please try again.");
      setSelectedIds(new Set());
    }
  }, [selectedIds, deleteResults]);

  const handleConfirmMerge = useCallback(
    async (
      primaryId: string,
      secondaryIds: string[],
      mergedData: Record<string, unknown>
    ) => {
      const allIds = [primaryId, ...secondaryIds];
      const missingItems = allIds.filter(
        (id) => !extractionResults.some((item) => item.id === id)
      );

      if (missingItems.length > 0) {
        alert(
          `Some items are no longer available: ${missingItems.length} items. Please refresh and try again.`
        );
        return;
      }

      try {
        await mergeResults(primaryId, secondaryIds, mergedData);
        setSelectedIds(new Set());
      } catch {
        alert("Failed to merge results. Please try again.");
        setSelectedIds(new Set());
      }
    },
    [mergeResults, extractionResults]
  );

  const handleDeleteSingle = useCallback(
    async (id: string) => {
      const itemExists = extractionResults.some((item) => item.id === id);
      if (!itemExists) {
        return;
      }

      try {
        await deleteResults([id]);
        setSelectedIds((prev) => {
          const updated = new Set(prev);
          updated.delete(id);
          return updated;
        });
      } catch {
        alert("Failed to delete result. Please try again.");
      }
    },
    [deleteResults, extractionResults]
  );

  const handleSortChange = useCallback(
    (property: string | null, direction: "asc" | "desc") => {
      setSortBy(property);
      setSortDirection(direction);
    },
    []
  );

  const handleFilterChange = useCallback(
    (property: string | null, value: string) => {
      setFilterProperty(property);
      setFilterValue(value);
    },
    []
  );

  const handleBackToProject = useCallback(() => {
    if (projectId) {
      navigate(`/projects/${projectId}`);
    } else {
      navigate("/projects");
    }
  }, [navigate, projectId]);

  const handleOpenManualEntry = useCallback(() => {
    setShowManualEntryModal(true);
  }, []);

  // Filter and sort results
  const filteredResults = useMemo(() => {
    let results = extractionResults;

    // Apply match filter
    if (matchFilter === "matched") {
      results = results.filter(
        (r) => r.supplierMatches && r.supplierMatches.length > 0
      );
    } else if (matchFilter === "unmatched") {
      results = results.filter(
        (r) => !r.supplierMatches || r.supplierMatches.length === 0
      );
    }

    // Apply property filter
    if (filterProperty && filterValue) {
      results = results.filter((result) => {
        const value =
          result.rawExtraction?.[filterProperty] ?? result[filterProperty];
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(filterValue.toLowerCase());
      });
    }

    // Apply sorting
    if (sortBy) {
      results = [...results].sort((a, b) => {
        const aValue = a.rawExtraction?.[sortBy] ?? a[sortBy];
        const bValue = b.rawExtraction?.[sortBy] ?? b[sortBy];

        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;

        const aStr = String(aValue);
        const bStr = String(bValue);

        const comparison = aStr.localeCompare(bStr, undefined, {
          numeric: true,
          sensitivity: "base"
        });

        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    return results;
  }, [
    extractionResults,
    matchFilter,
    sortBy,
    sortDirection,
    filterProperty,
    filterValue
  ]);

  if (!jobId) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto text-center py-12">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600 font-medium">No extraction job selected</p>
          <p className="text-sm text-gray-500 mt-1">
            Please select an extraction job from the projects page.
          </p>
        </div>
      </div>
    );
  }

  const matchedCount = extractionResults.filter(
    (r) => r.supplierMatches && r.supplierMatches.length > 0
  ).length;
  const unmatchedCount = extractionResults.length - matchedCount;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-4">
        <ExtractionResultsToolbar
          jobName={jobName}
          totalCount={extractionResults.length}
          acceptedCount={summaryStats.acceptedCount}
          pendingCount={summaryStats.pendingCount}
          matchedCount={matchedCount}
          unmatchedCount={unmatchedCount}
          matchFilter={matchFilter}
          sortBy={sortBy}
          sortDirection={sortDirection}
          filterProperty={filterProperty}
          filterValue={filterValue}
          schemaProperties={schemaProperties}
          hasSuppliers={hasSuppliers}
          isLoadingSuppliers={isLoadingSuppliers}
          isMatching={isMatching}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onMatchFilterChange={setMatchFilter}
          onSortChange={handleSortChange}
          onFilterChange={handleFilterChange}
          onMatchSuppliers={matchSuppliers}
          onOpenExport={openExportDialog}
          onManualEntry={handleOpenManualEntry}
          onBackToProject={handleBackToProject}
        />
      </div>

      <ExtractionPageContent
        viewMode={viewMode}
        loading={loading}
        error={error}
        results={results}
        filteredResults={filteredResults}
        schemaProperties={schemaProperties}
        selectedIds={selectedIds}
        editingCell={editingCell}
        editValue={editValue}
        isDeletingResults={isDeletingResults}
        isMergingResults={isMergingResults}
        updatingSupplierForRow={updatingSupplierForRow}
        sortBy={sortBy}
        sortDirection={sortDirection}
        filterProperty={filterProperty}
        filterValue={filterValue}
        onStartEdit={startEdit}
        onSaveEdit={saveEdit}
        onCancelEdit={cancelEdit}
        onSelect={handleSelect}
        onStatusChange={handleStatusChange}
        onEditValueChange={setEditValue}
        onDelete={handleDeleteSingle}
        onSelectSupplier={handleSelectSupplier}
        onRefetch={refetch}
        onClearSelection={handleClearSelection}
        onConfirmDelete={handleConfirmDelete}
        onConfirmMerge={handleConfirmMerge}
        onSortChange={handleSortChange}
        onFilterChange={handleFilterChange}
      />

      {/* Manual Entry Modal */}
      <ManualEntryModal
        open={showManualEntryModal}
        onOpenChange={setShowManualEntryModal}
        onSubmit={handleManualEntrySubmit}
        schema={schema}
        isSubmitting={isCreatingManual}
      />

      {/* Export CSV Dialog */}
      <ExportCSVDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        results={extractionResults}
        jobName={jobName}
        schemaProperties={schemaProperties}
      />
    </div>
  );
}
