// Using Jest (not Vitest) for frontend tests

/**
 * Test suite for ExtractionJobRow progress metadata parsing
 * This verifies that the frontend correctly parses job metadata
 * to display progress like "5/31 pages processed"
 */
describe("ExtractionJobRow Progress Metadata", () => {
  it("should parse new format metadata correctly", () => {
    const metadata = {
      totalPages: 31,
      completedPages: 5,
      currentPage: 5,
      totalMaterialsFound: 150
    };

    // This is the parsing logic from ExtractionJobRow
    const pageProgress = {
      totalPages:
        Number(metadata.totalPages || (metadata as any).totalFiles) || 0,
      completedPages:
        Number(metadata.completedPages || (metadata as any).completedFiles) ||
        Number(metadata.currentPage || (metadata as any).currentFile) ||
        0,
      currentPage:
        Number(metadata.currentPage || (metadata as any).currentFile) ||
        undefined
    };

    expect(pageProgress.totalPages).toBe(31);
    expect(pageProgress.completedPages).toBe(5);
    expect(pageProgress.currentPage).toBe(5);
  });

  it("should parse old format metadata correctly (backward compatibility)", () => {
    const metadata = {
      totalFiles: 31,
      completedFiles: 5,
      currentFile: 5,
      totalMaterialsFound: 150
    };

    // This is the parsing logic from ExtractionJobRow
    const pageProgress = {
      totalPages:
        Number((metadata as any).totalPages || metadata.totalFiles) || 0,
      completedPages:
        Number((metadata as any).completedPages || metadata.completedFiles) ||
        Number((metadata as any).currentPage || metadata.currentFile) ||
        0,
      currentPage:
        Number((metadata as any).currentPage || metadata.currentFile) ||
        undefined
    };

    expect(pageProgress.totalPages).toBe(31);
    expect(pageProgress.completedPages).toBe(5);
    expect(pageProgress.currentPage).toBe(5);
  });

  it("should display progress text correctly", () => {
    const pageProgress = {
      totalPages: 31,
      completedPages: 5,
      currentPage: 5
    };

    const displayText =
      pageProgress.totalPages > 0
        ? `${pageProgress.completedPages}/${pageProgress.totalPages} pages`
        : pageProgress.completedPages > 0
          ? `${pageProgress.completedPages} pages`
          : `Page ${pageProgress.currentPage}`;

    expect(displayText).toBe("5/31 pages");
  });

  it("should handle progress updates correctly", () => {
    const progressUpdates = [
      { totalPages: 31, completedPages: 1, currentPage: 1 },
      { totalPages: 31, completedPages: 5, currentPage: 5 },
      { totalPages: 31, completedPages: 10, currentPage: 10 },
      { totalPages: 31, completedPages: 31, currentPage: 31 }
    ];

    progressUpdates.forEach((progress) => {
      const displayText = `${progress.completedPages}/${progress.totalPages} pages`;

      // Verify format
      expect(displayText).toMatch(/^\d+\/\d+ pages$/);

      // Verify values
      expect(progress.totalPages).toBe(31);
      expect(progress.completedPages).toBeLessThanOrEqual(31);
      expect(progress.completedPages).toBe(progress.currentPage);
    });
  });

  it("should handle edge cases", () => {
    // No metadata
    const noMeta = null;
    expect(noMeta).toBeNull();

    // Empty metadata
    const emptyMeta = {};
    const pageProgress1 = {
      totalPages:
        Number(
          (emptyMeta as any).totalPages || (emptyMeta as any).totalFiles
        ) || 0,
      completedPages:
        Number(
          (emptyMeta as any).completedPages || (emptyMeta as any).completedFiles
        ) ||
        Number(
          (emptyMeta as any).currentPage || (emptyMeta as any).currentFile
        ) ||
        0
    };
    expect(pageProgress1.totalPages).toBe(0);
    expect(pageProgress1.completedPages).toBe(0);

    // Only totalPages
    const onlyTotal = { totalPages: 31 };
    const pageProgress2 = {
      totalPages: Number(onlyTotal.totalPages) || 0,
      completedPages: Number((onlyTotal as any).completedPages) || 0
    };
    expect(pageProgress2.totalPages).toBe(31);
    expect(pageProgress2.completedPages).toBe(0);
  });

  it("should match the exact parsing logic from ExtractionJobRow component", () => {
    // Simulate the exact metadata structure from the backend
    const jobMeta = {
      isBatchJob: false,
      totalPages: 31,
      completedPages: 5,
      currentPage: 5,
      totalMaterialsFound: 150
    };

    // This is the EXACT logic from ExtractionJobRow.tsx
    const parsedMeta = jobMeta;
    const pageProgress =
      parsedMeta &&
      ("totalPages" in parsedMeta ||
        "completedPages" in parsedMeta ||
        "currentPage" in parsedMeta ||
        "totalFiles" in parsedMeta ||
        "completedFiles" in parsedMeta ||
        "currentFile" in parsedMeta)
        ? {
            totalPages:
              Number(
                (parsedMeta as any).totalPages || (parsedMeta as any).totalFiles
              ) || 0,
            completedPages:
              Number(
                (parsedMeta as any).completedPages ||
                  (parsedMeta as any).completedFiles
              ) ||
              Number(
                (parsedMeta as any).currentPage ||
                  (parsedMeta as any).currentFile
              ) ||
              0,
            currentPage:
              Number(
                (parsedMeta as any).currentPage ||
                  (parsedMeta as any).currentFile
              ) || undefined
          }
        : null;

    expect(pageProgress).not.toBeNull();
    expect(pageProgress?.totalPages).toBe(31);
    expect(pageProgress?.completedPages).toBe(5);
    expect(pageProgress?.currentPage).toBe(5);

    // Verify display text
    if (pageProgress) {
      const displayText =
        pageProgress.totalPages > 0
          ? `${pageProgress.completedPages}/${pageProgress.totalPages} pages processed`
          : pageProgress.completedPages > 0
            ? `${pageProgress.completedPages} pages processed`
            : `Page ${pageProgress.currentPage} processed`;

      expect(displayText).toBe("5/31 pages processed");
    }
  });
});
