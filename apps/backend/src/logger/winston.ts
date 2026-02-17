import { createLogger, format, transports } from "winston";

const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  return `${timestamp} [${level}]: ${message} ${
    Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ""
  }`;
});

// Modules that should use DEBUG level or lower to reduce noise
const VERBOSE_MODULES = {
  UsersDatabaseService: "debug",
  OrganizationsDatabaseService: "debug",
  ClientsDatabaseService: "debug",
  SuppliersDatabaseService: "debug",
  SupplierMatchesDatabaseService: "debug",
  RealtimeGateway: "warn", // Suppress ping/pong, only log errors and important events
  PgListenerService: "warn" // Suppress debug logs, only warnings and errors
};

/**
 * Custom filter to suppress verbose transactional logs
 * while keeping important error and business logic logs
 */
const suppressVerboseLogs = format((info) => {
  const { context, message } = info;
  const currentLogLevel = process.env.LOG_LEVEL || "info";

  // Get the module name from context
  const moduleName = context?.context || context;

  // Check if this is a verbose module
  const minLevel = VERBOSE_MODULES[moduleName as keyof typeof VERBOSE_MODULES];

  if (minLevel) {
    const logLevels = { error: 0, warn: 1, info: 2, debug: 3, verbose: 4 };
    const currentLevel = logLevels[info.level as keyof typeof logLevels] || 2;
    const minLevelNum = logLevels[minLevel as keyof typeof logLevels] || 2;

    // If message is below the minimum level for this module, suppress it
    if (currentLevel > minLevelNum) {
      return false;
    }
  }

  // Additional suppression for non-production debug logs
  if (currentLogLevel === "info" || currentLogLevel === "warn") {
    // Suppress audit debug logs (Method X started, Action completed)
    if (
      info.level === "debug" &&
      (message?.includes("Method") ||
        message?.includes("Action completed") ||
        message?.includes("Fetching"))
    ) {
      return false;
    }

    // Suppress RealtimeGateway client connection logs at debug
    if (
      info.level === "debug" &&
      (message?.includes("Client connected") ||
        message?.includes("Client disconnected"))
    ) {
      return false;
    }

    // Suppress PgListener reconnect logs at warn level when not critical
    if (info.level === "warn" && message?.includes("pgListenerConnectFailed")) {
      return false;
    }
  }

  return info;
})();

export const createGlobalLogger = () => {
  return createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: combine(timestamp(), suppressVerboseLogs, colorize(), logFormat),
    transports: [
      new transports.Console({
        format: combine(colorize(), logFormat)
      })
    ]
  });
};
