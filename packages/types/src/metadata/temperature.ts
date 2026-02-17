/**
 * Data temperature classification for repositories
 * Determines caching strategy and realtime update requirements
 */
export type DataTemperature = "hot" | "cold";

/**
 * Metadata describing repository characteristics
 */
export interface RepositoryMetadata {
  temperature: DataTemperature;
  description: string;
}

/**
 * Temperature classification for each domain
 * Hot data: Requires realtime updates (WebSocket)
 * Cold data: Changes infrequently, HTTP + Cache sufficient
 */
export const REPOSITORY_METADATA = {
  clients: {
    temperature: "cold" as const,
    description: "Client data changes infrequently"
  },
  projects: {
    temperature: "cold" as const,
    description: "Project data is mostly static"
  },
  suppliers: {
    temperature: "cold" as const,
    description: "Supplier data changes infrequently"
  },
  extractionJobs: {
    temperature: "hot" as const,
    description: "Jobs have realtime progress updates"
  },
  extractionResults: {
    temperature: "hot" as const,
    description: "Results stream in realtime"
  },
  extractionSchemas: {
    temperature: "cold" as const,
    description: "Schema definitions are mostly static"
  },
  organizations: {
    temperature: "cold" as const,
    description: "Organization data changes infrequently"
  },
  users: {
    temperature: "cold" as const,
    description: "User data changes infrequently"
  },
  invitations: {
    temperature: "cold" as const,
    description: "Invitation data changes infrequently"
  },
  auditLogs: {
    temperature: "cold" as const,
    description: "Audit logs are append-only"
  }
} as const;
