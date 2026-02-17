/**
 * Diagnostic Logger Utility
 *
 * Tracks unique log messages with counts to avoid console spam while
 * providing visibility into how frequently issues occur.
 *
 * Usage:
 *   const logger = createDiagnosticLogger('MyComponent');
 *   logger.log('Error message', { key: 'value' });
 *   // First occurrence logs to console
 *   // Subsequent occurrences increment counter
 *   // Dictionary summary logs every N unique messages
 */

export interface DiagnosticLoggerOptions {
  /**
   * Component/context name for the logger
   */
  component: string;
  /**
   * Log the dictionary summary every N unique messages
   * @default 10
   */
  summaryInterval?: number;
  /**
   * Whether to enable logging (useful for feature flags)
   * @default true
   */
  enabled?: boolean;
}

export interface DiagnosticLogger {
  /**
   * Log a diagnostic message. First occurrence logs to console,
   * subsequent occurrences increment counter.
   */
  log(message: string, data?: any): void;
  /**
   * Get the current dictionary of all logged messages with counts
   */
  getDictionary(): Record<string, number>;
  /**
   * Clear all logged messages
   */
  clear(): void;
  /**
   * Force log the dictionary summary
   */
  logSummary(): void;
}

/**
 * Create a diagnostic logger instance
 */
export function createDiagnosticLogger(
  options: DiagnosticLoggerOptions | string
): DiagnosticLogger {
  const config: Required<Omit<DiagnosticLoggerOptions, "component">> & {
    component: string;
  } =
    typeof options === "string"
      ? {
          component: options,
          summaryInterval: 10,
          enabled: true
        }
      : {
          component: options.component,
          summaryInterval: options.summaryInterval ?? 10,
          enabled: options.enabled ?? true
        };

  const diagnosticLogs = new Map<string, number>();

  return {
    log(message: string, data?: any): void {
      if (!config.enabled) {
        return;
      }

      const logString = data
        ? `[${config.component}] ${message} ${JSON.stringify(data)}`
        : `[${config.component}] ${message}`;

      const currentCount = diagnosticLogs.get(logString) || 0;
      diagnosticLogs.set(logString, currentCount + 1);

      // Log first occurrence to console
      if (currentCount === 0) {
        console.log(logString);
      }

      // Log dictionary summary periodically
      if (diagnosticLogs.size % config.summaryInterval === 0) {
        console.log(
          `[${config.component} Diagnostic Logs Dictionary]`,
          Object.fromEntries(diagnosticLogs)
        );
      }
    },

    getDictionary(): Record<string, number> {
      return Object.fromEntries(diagnosticLogs);
    },

    clear(): void {
      diagnosticLogs.clear();
    },

    logSummary(): void {
      if (!config.enabled || diagnosticLogs.size === 0) {
        return;
      }
      console.log(
        `[${config.component} Diagnostic Logs Dictionary]`,
        Object.fromEntries(diagnosticLogs)
      );
    }
  };
}
