# Client Architecture Refactor

## Overview

This specification defines a **three-layer client architecture** with clear separation between contracts, implementation, and application logic.

## The Big Idea

**Two States, Two Systems:**

1. **Server State** (from backend) → Managed by TanStack Query + Persistence Layer + WebSocket (hot data only)
2. **Application State** (frontend only) → Managed by Redux-like state manager (Immer-based)

**Key Rule:** Never duplicate server data in Redux. Redux is for app/UI state only.

## Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Application (UI + Redux-like State)                │
│ - React Components                                           │
│ - Redux-like State Manager (selections, filters, drafts)    │
│ - Hooks combining server data + app state                   │
└────────────────────┬─────────────────────────────────────────┘
                     │
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Client Core (@packages/core-client)                │
│ - Persistence Service Provider (singleton)                  │
│ - Hot Repositories (HTTP + Cache + WebSocket)               │
│ - Cold Repositories (HTTP + Cache only)                     │
└────────────────────┬─────────────────────────────────────────┘
                     │
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Contracts (@packages/types)                        │
│ - Domain Models (Client, Project, ExtractionJob, etc.)      │
│ - Repository Interfaces (CRUD operations)                   │
│ - Data Temperature Metadata (hot vs cold)                   │
└─────────────────────────────────────────────────────────────┘
```

## Hot vs Cold Data

### Cold Data (HTTP + Cache)

- **Characteristics:** Changes infrequently, eventual consistency OK
- **Examples:** Clients, Projects, Suppliers
- **Implementation:** HTTP + TanStack Query cache (5 min TTL)
- **No WebSocket**

### Hot Data (HTTP + Cache + WebSocket)

- **Characteristics:** Realtime/streaming, needs to feel "live"
- **Examples:** Extraction Jobs, Extraction Results
- **Implementation:** HTTP + TanStack Query + WebSocket updates
- **WebSocket updates cache directly**

## Key Concepts

### 1. Persistence Service Provider (Singleton)

```typescript
const persistence = getPersistenceServiceProvider();

// Cold repositories
await persistence.clients.findMany();
await persistence.projects.findById(id);

// Hot repositories (with WebSocket)
await persistence.extractionJobs.findById(id);
await persistence.extractionResults.findMany();
```

### 2. State Separation

```typescript
// ✅ GOOD: Redux stores app state only
interface AppState {
  ui: {
    selectedProjectId: string | null; // Just IDs
    selectedClientId: string | null;
    isExtractionPanelOpen: boolean;
    projectFilters: { search: string; status: string };
  };
  drafts: {
    projectDraft: Partial<Project> | null;
  };
}

// ❌ BAD: Don't duplicate server data
interface BadState {
  projects: Project[]; // Already in TanStack!
  clients: Client[]; // Already in TanStack!
}
```

### 3. Data Flow

**Cold Data Example (Clients):**

1. Component reads filters from Redux
2. Fetches clients via TanStack + persistence layer
3. User selects client → Redux updates `selectedClientId`
4. Component re-renders with selection

**Hot Data Example (Extraction Job):**

1. Redux knows which job is active
2. TanStack fetches job via hot repository
3. WebSocket updates arrive → repository updates cache
4. TanStack notifies component → re-render
5. Redux handles panel open/close

## Documents

- **[DETAILED_ARCHITECTURE.md](./DETAILED_ARCHITECTURE.md)** - Complete specification with all implementation details

## Quick Start

### 1. Define Contracts (@packages/types)

```typescript
// entities/project.types.ts
export interface Project {
  id: string;
  name: string;
  clientId: string;
  status: "active" | "archived";
}

// contracts/project.contract.ts
export interface IProjectRepository {
  findById(id: string): Promise<Project | null>;
  findMany(filter?: Partial<Project>): Promise<Project[]>;
  create(data: CreateProjectDto): Promise<Project>;
  update(id: string, data: UpdateProjectDto): Promise<Project>;
}
```

### 2. Implement Repository (@packages/core-client)

```typescript
// Cold repository (no WebSocket)
export class ProjectRepository implements IProjectRepository {
  constructor(
    private adapter: IDatabaseAdapter,
    private cache: ICacheService
  ) {}

  async findMany(filter?: Partial<Project>): Promise<Project[]> {
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const projects = await this.adapter.get("/projects", filter);
    await this.cache.set(cacheKey, projects, 300); // 5 min
    return projects;
  }
}

// Hot repository (with WebSocket)
export class ExtractionJobRepository implements IExtractionJobRepository {
  constructor(
    private adapter: IDatabaseAdapter,
    private cache: ICacheService,
    private ws: IWebSocketService // ← WebSocket for hot data
  ) {
    this.ws.subscribe("extraction_jobs", this.handleUpdate.bind(this));
  }

  private handleUpdate(payload: WebSocketPayload): void {
    // WebSocket updates cache directly
    this.cache.set(cacheKey, payload.data, 30);
  }
}
```

### 3. Use in Frontend

```typescript
// Component
function ProjectsPage() {
  // App state from Redux
  const selectedId = useAppState(state => state.ui.selectedProjectId);
  const filters = useAppState(state => state.ui.projectFilters);

  // Server data from TanStack + persistence
  const persistence = getPersistenceServiceProvider();
  const { data: projects } = useQuery(
    ['projects', filters],
    () => persistence.projects.findMany(filters)
  );

  // Combine both
  return (
    <div>
      {projects?.map(project => (
        <ProjectCard
          project={project}  // From TanStack
          isSelected={project.id === selectedId}  // From Redux
        />
      ))}
    </div>
  );
}
```

## Benefits

1. **Clear Separation:** Contracts → Implementation → Application
2. **Type Safety:** Full TypeScript from database to UI
3. **Testability:** Injectable services, easy to mock
4. **Flexibility:** Swap implementations (HTTP → GraphQL)
5. **Scalability:** Hot vs cold based on data temperature
6. **No Duplication:** Server data in TanStack, app state in Redux

## Migration Strategy

See [DETAILED_ARCHITECTURE.md](./DETAILED_ARCHITECTURE.md) for complete migration plan.

**Summary:**

1. Week 1: Create packages, extract types
2. Week 2: Implement core services
3. Week 3: Implement persistence layer
4. Week 4: Implement state management
5. Week 5-6: Migrate frontend pages
6. Week 7: Cleanup and optimization
