/**
 * Configuration for audit logging behavior
 */
export interface AuditConfig {
  // Maximum size in bytes for JSON fields (before/after)
  maxJsonSize: number;

  // Tables to exclude from audit logging
  excludedTables: string[];

  // Tables that should only log basic info (no before/after data)
  lightweightTables: string[];

  // Fields to exclude from audit data for specific tables
  excludedFields: Record<string, string[]>;

  // Enable async audit logging (better performance)
  asyncLogging: boolean;
}

// Default audit configuration
export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  maxJsonSize: 50 * 1024, // 50KB max per JSON field
  excludedTables: [
    "AuditLog", // Prevent infinite recursion
    "_prisma_migrations" // Skip internal Prisma tables
  ],
  lightweightTables: [
    "DataLayer" // Large files metadata - only log IDs and basic info
  ],
  excludedFields: {
    User: ["password", "salt"], // Never log sensitive auth data
    ExtractionResult: ["rawExtraction", "verifiedData"] // These can be very large
  },
  asyncLogging: true
};

/**
 * Sanitize data for audit logging based on configuration
 */
export function sanitizeAuditData(
  data: unknown,
  tableName: string,
  config: AuditConfig = DEFAULT_AUDIT_CONFIG
): unknown {
  if (!data || typeof data !== "object") {
    return data;
  }

  // Clone the data to avoid modifying the original
  const sanitized = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;

  // Remove excluded fields for this table
  const excludedFields = config.excludedFields[tableName] || [];
  excludedFields.forEach((field) => {
    if (field in sanitized) {
      sanitized[field] = "[EXCLUDED]";
    }
  });

  // Check size and truncate if necessary
  const jsonString = JSON.stringify(sanitized);
  if (jsonString.length > config.maxJsonSize) {
    return {
      _truncated: true,
      _originalSize: jsonString.length,
      _maxSize: config.maxJsonSize,
      id: sanitized.id,
      // Keep essential fields
      ...Object.fromEntries(
        Object.entries(sanitized)
          .filter(
            ([key, value]) =>
              ["id", "name", "title", "email", "status"].includes(key) &&
              typeof value === "string" &&
              value.length < 100
          )
          .slice(0, 5) // Keep max 5 essential fields
      )
    };
  }

  return sanitized;
}

/**
 * Check if a table should be audited based on configuration
 */
export function shouldAuditTable(
  tableName: string,
  config: AuditConfig = DEFAULT_AUDIT_CONFIG
): boolean {
  return !config.excludedTables.includes(tableName);
}

/**
 * Check if a table should use lightweight audit logging
 */
export function isLightweightTable(
  tableName: string,
  config: AuditConfig = DEFAULT_AUDIT_CONFIG
): boolean {
  return config.lightweightTables.includes(tableName);
}
