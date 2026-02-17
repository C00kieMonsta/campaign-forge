import { z } from "zod";

/**
 * Extraction job metadata - Progress tracking information
 * Stores job-specific metadata like page progress during PDF extraction
 */
export const ExtractionJobPageProgressSchema = z.object({
  totalPages: z.number().int().nonnegative().optional(),
  completedPages: z.number().int().nonnegative().optional(),
  currentPage: z.number().int().nonnegative().optional()
});

export type ExtractionJobPageProgress = z.infer<
  typeof ExtractionJobPageProgressSchema
>;

/**
 * Helper to safely parse and validate extraction job metadata
 */
export function parseExtractionJobMetadata(
  meta: unknown
): ExtractionJobPageProgress | null {
  if (!meta) return null;

  // If it's a string, parse it as JSON
  if (typeof meta === "string") {
    try {
      const parsed = JSON.parse(meta);
      const result = ExtractionJobPageProgressSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  // If it's an object, validate directly
  if (typeof meta === "object" && meta !== null) {
    const result = ExtractionJobPageProgressSchema.safeParse(meta);
    return result.success ? result.data : null;
  }

  return null;
}

/**
 * Check if metadata has any page progress information
 */
export function hasPageProgress(metadata: ExtractionJobPageProgress | null): boolean {
  if (!metadata) return false;
  return (
    (metadata.totalPages ?? 0) > 0 ||
    (metadata.completedPages ?? 0) > 0 ||
    (metadata.currentPage ?? 0) > 0
  );
}

/**
 * Format page progress for display
 */
export function formatPageProgress(metadata: ExtractionJobPageProgress | null): string {
  if (!metadata) return "";

  if ((metadata.totalPages ?? 0) > 0) {
    return `${metadata.completedPages ?? 0}/${metadata.totalPages} pages`;
  }

  if ((metadata.completedPages ?? 0) > 0) {
    return `${metadata.completedPages} pages`;
  }

  if ((metadata.currentPage ?? 0) > 0) {
    return `Page ${metadata.currentPage}`;
  }

  return "";
}

