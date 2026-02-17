export const qk = {
  projects: {
    // Root for wildcard invalidation
    lists: () => ["projects:list"] as const,

    // List with params - collision-free approach
    list: (p: {
      clientId: string;
      page?: number;
      limit?: number;
      status?: string;
    }) => ["projects:list", p] as const,

    // Detail pages
    detail: (id: string) => ["projects:detail", { id }] as const,

    // Project data (files & extraction jobs) - separate namespace
    data: (id: string) => ["projects:data", { id }] as const
  },

  clients: {
    lists: () => ["clients:list"] as const,
    list: (page?: number, limit?: number) =>
      ["clients:list", { page, limit }] as const,
    detail: (id: string | null) => ["clients:detail", { id }] as const
  },

  dashboard: {
    metrics: (clientId?: string) =>
      ["dashboard:metrics", { clientId }] as const,
    clientMetrics: (clientId?: string | null) =>
      ["dashboard:clientMetrics", { clientId }] as const
  },

  extraction: {
    results: (jobId: string) => ["extraction:results", { jobId }] as const,
    job: (jobId: string) => ["extraction:job", { jobId }] as const,
    supplierMatches: (jobId: string) =>
      ["extraction:supplier-matches", { jobId }] as const
  },

  files: {
    downloadUrl: (dataLayerId: string, bucket: string = "processing") =>
      ["files:download-url", { dataLayerId, bucket }] as const
  },

  suppliers: {
    lists: () => ["suppliers:list"] as const,
    list: (page?: number, limit?: number) =>
      ["suppliers:list", { page, limit }] as const,
    detail: (id: string | null) => ["suppliers:detail", { id }] as const
  }
} as const;
