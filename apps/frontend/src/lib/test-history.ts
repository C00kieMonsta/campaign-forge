/**
 * Test extraction history management using localStorage
 */

export interface StoredTestResult {
  id: string;
  timestamp: number;
  schemaId: string;
  schemaName: string;
  fileName: string;
  results: Array<Record<string, unknown>>;
  meta: {
    processedPages: number;
    totalPages: number;
    durationMs: number;
    schema: { id: string; name: string };
  };
}

const STORAGE_KEY = "extraction-test-history";
const MAX_TESTS = 10;

/**
 * Get all stored test results
 */
export function getTestHistory(): StoredTestResult[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const history = JSON.parse(stored) as StoredTestResult[];
    // Return newest first
    return history.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error("Failed to load test history:", error);
    return [];
  }
}

/**
 * Save a new test result to history
 */
export function saveTestResult(
  schemaId: string,
  schemaName: string,
  fileName: string,
  results: Array<Record<string, unknown>>,
  meta: StoredTestResult["meta"]
): void {
  try {
    const history = getTestHistory();

    const newTest: StoredTestResult = {
      id: `${schemaId}-${Date.now()}`,
      timestamp: Date.now(),
      schemaId,
      schemaName,
      fileName,
      results,
      meta
    };

    // Add new test at the beginning
    const updatedHistory = [newTest, ...history];

    // Keep only the last MAX_TESTS
    const trimmedHistory = updatedHistory.slice(0, MAX_TESTS);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedHistory));
  } catch (error) {
    console.error("Failed to save test result:", error);
  }
}

/**
 * Get test results for a specific schema
 */
export function getSchemaTestHistory(schemaId: string): StoredTestResult[] {
  const history = getTestHistory();
  return history.filter((test) => test.schemaId === schemaId);
}

/**
 * Clear all test history
 */
export function clearTestHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear test history:", error);
  }
}

/**
 * Delete a specific test from history
 */
export function deleteTestResult(testId: string): void {
  try {
    const history = getTestHistory();
    const updated = history.filter((test) => test.id !== testId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Failed to delete test result:", error);
  }
}

/**
 * Format timestamp for display
 */
export function formatTestTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
