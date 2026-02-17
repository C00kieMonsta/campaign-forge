/**
 * Flexible date utilities that handle both string and Date inputs
 */

export function toDate(dateValue: string | Date | any): Date {
  if (typeof dateValue === "string") {
    return new Date(dateValue);
  }
  if (dateValue instanceof Date) {
    return dateValue;
  }
  return new Date(dateValue);
}

export function formatDate(
  dateValue: string | Date | any,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = toDate(dateValue);
  return date.toLocaleDateString(
    "en-US",
    options || {
      year: "numeric",
      month: "short",
      day: "numeric"
    }
  );
}

export function formatRelativeDate(dateValue: string | Date | any): string {
  const date = toDate(dateValue);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInDays === 0) return "Today";
  if (diffInDays === 1) return "Yesterday";
  if (diffInDays < 7) return `${diffInDays} days ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
  if (diffInDays < 365) return `${Math.floor(diffInDays / 30)} months ago`;
  return `${Math.floor(diffInDays / 365)} years ago`;
}

export function toISOString(dateValue: string | Date | any): string {
  if (typeof dateValue === "string") {
    return dateValue;
  }
  return toDate(dateValue).toISOString();
}
