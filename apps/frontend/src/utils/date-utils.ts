/**
 * Safe date utilities to handle various date formats and null values
 */

/**
 * Safely convert a value to ISO string or return null
 */
export function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  // If it's already a Date object
  if (value instanceof Date) {
    return !isNaN(value.getTime()) ? value.toISOString() : null;
  }

  // If it's a string or number, try to parse it
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return !isNaN(date.getTime()) ? date.toISOString() : null;
  }

  // For objects that might have date-like properties
  if (typeof value === "object" && value !== null) {
    // Handle objects that might be serialized dates
    const dateValue =
      (
        value as { toISOString?: () => string; toString?: () => string }
      ).toISOString?.() || (value as { toString?: () => string }).toString?.();
    if (dateValue) {
      const date = new Date(dateValue);
      return !isNaN(date.getTime()) ? date.toISOString() : null;
    }
  }

  return null;
}

/**
 * Format a date value safely
 */
export function formatDateSafe(
  value: unknown,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }
): string {
  const isoString = toIsoOrNull(value);
  if (!isoString) {
    return "--";
  }

  try {
    return new Date(isoString).toLocaleDateString("en-US", options);
  } catch {
    return "--";
  }
}

/**
 * Get a relative time string (e.g., "2 hours ago")
 */
export function getRelativeTime(value: unknown): string {
  const isoString = toIsoOrNull(value);
  if (!isoString) {
    return "--";
  }

  try {
    const date = new Date(isoString);
    const now = Date.now(); // Use Date.now() directly for easier mocking
    const diffMs = now - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;

    return formatDateSafe(value, { month: "short", day: "numeric" });
  } catch {
    return "--";
  }
}
