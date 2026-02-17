// Prisma query include shapes - reusable across database services
// Ensures consistency when fetching extraction jobs

export const EXTRACTION_JOB_INCLUDE_SHAPE = {
  initiator: {
    select: {
      id: true,
      firstName: true,
      lastName: true
    }
  },
  schema: {
    select: {
      id: true,
      name: true,
      version: true,
      schemaIdentifier: true
    }
  },
  extractionJobDataLayers: {
    include: {
      dataLayer: {
        select: {
          id: true,
          name: true,
          fileType: true
        }
      }
    },
    orderBy: {
      processingOrder: "asc" as const
    }
  }
} as const;

export const EXTRACTION_JOB_MINIMAL_INCLUDE = {
  initiator: {
    select: {
      id: true,
      firstName: true,
      lastName: true
    }
  }
} as const;

// For queries that need more detailed data layer info
export const EXTRACTION_JOB_DETAILED_INCLUDE = {
  initiator: {
    select: {
      id: true,
      firstName: true,
      lastName: true
    }
  },
  extractionJobDataLayers: {
    include: {
      dataLayer: {
        select: {
          id: true,
          name: true,
          fileType: true,
          filePath: true
        }
      }
    },
    orderBy: {
      processingOrder: "asc" as const
    }
  }
} as const;

