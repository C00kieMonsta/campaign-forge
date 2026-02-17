# Detailed Architecture Specification

## Table of Contents

1. [Overall Goal](#overall-goal)
2. [Layer 1: Contracts/Types](#layer-1-contracts--types)
3. [Layer 2: Client Core](#layer-2-client-core)
4. [Layer 3: Application Layer](#layer-3-application-layer)
5. [Hot vs Cold Data](#hot-vs-cold-data)
6. [State Separation](#state-separation)
7. [Data Flow Examples](#data-flow-examples)

---

## Overall Goal

Design a client architecture where:

- **All data access** goes through a single abstraction layer
- **Data shape and operations** are defined once (as contracts)
- **Different domains** can choose different interaction styles based on data temperature
- **Three clear layers** with distinct responsibilities

---

## Layer 1: Contracts / Types

### Purpose

Pure definition layer - the "what" without the "how"

### Location

`@packages/types`

### Contains

#### 1. Domain Models

```typescript
// entities/project.types.ts
export interface Project {
  id: string;
  name: string;
  clientId: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}
```

#### 2. Repository Interfaces

```typescript
// contracts/project.contract.ts
export interface IProjectRepository {
  findById(id: string): Promise<Project | null>;
  findMany(filter?: Partial<Project>): Promise<Project[]>;
  create(data: CreateProjectDto): Promise<Project>;
  update(id: string, data: UpdateProjectDto): Promise<Project>;
  delete(id: string): Promise<void>;
}
```

#### 3. Data Temperature Metadata

```typescript
// contracts/metadata.ts
export type DataTemperature = "hot" | "cold";

export interface RepositoryMetadata {
  temperature: DataTemperature;
  description: string;
}

// Define temperature for each domain
export const REPOSITORY_METADATA = {
  clients: {
    temperature: "cold",
    description: "Client data changes infrequently"
  },
  projects: {
    temperature: "cold",
    description: "Project data is mostly static"
  },
  extractionJobs: {
    temperature: "hot",
    description: "Jobs have realtime progress"
  },
  extractionResults: {
    temperature: "hot",
    description: "Results stream in realtime"
  }
} as const;
```

### Key Rules

- ❌ No HTTP logic
- ❌ No WebSocket logic
- ❌ No cache logic
- ✅ Only types and interfaces
- ✅ Other layers must conform to these contracts

---

## Layer 2: Client Core

### Purpose

Implement contracts for a specific client (web, mobile, etc.)

### Location

`@packages/core-client`

### Contains

#### 1. Repository Implementations

**Cold Repository Example:**

```typescript
// services/persistence/client-repository.ts
export class ClientRepository implements IClientRepository {
  constructor(
    private adapter: IDatabaseAdapter,
    private cache: ICacheService
    // No WebSocket - this is cold data
  ) {}

  async findMany(filter?: Partial<Client>): Promise<Client[]> {
    const cacheKey = `clients:${JSON.stringify(filter)}`;

    // Try cache first
    const cached = await this.cache.get<Client[]>(cacheKey);
    if (cached) return cached;

    // Fetch via HTTP
    const clients = await this.adapter.get<Client[]>("/clients", filter);

    // Cache for 5 minutes
    await this.cache.set(cacheKey, clients, 300);

    return clients;
  }
}
```

**Hot Repository Example:**

```typescript
// services/persistence/extraction-job-repository.ts
export class ExtractionJobRepository implements IExtractionJobRepository {
  constructor(
    private adapter: IDatabaseAdapter,
    private cache: ICacheService,
    private ws: IWebSocketService // WebSocket for hot data
  ) {
    // Subscribe to realtime updates
    this.ws.subscribe("extraction_jobs", this.handleRealtimeUpdate.bind(this));
  }

  async findById(id: string): Promise<ExtractionJob | null> {
    const cacheKey = `extraction_job:${id}`;

    // Try cache
    const cached = await this.cache.get<ExtractionJob>(cacheKey);
    if (cached) return cached;

    // Fetch via HTTP
    const job = await this.adapter.get<ExtractionJob>(`/extraction/jobs/${id}`);

    // Cache (short TTL for hot data)
    await this.cache.set(cacheKey, job, 30);

    return job;
  }

  private handleRealtimeUpdate(payload: WebSocketPayload): void {
    // WebSocket updates cache directly
    if (payload.op === "UPDATE") {
      const cacheKey = `extraction_job:${payload.data.id}`;
      this.cache.set(cacheKey, payload.data, 30);
    }
  }
}
```

#### 2. Persistence Service Provider (Singleton)

```typescript
// providers/persistence-service.provider.ts
export class PersistenceServiceProvider {
  private static instance: PersistenceServiceProvider;

  private constructor(
    private adapter: IDatabaseAdapter,
    private cache: ICacheService,
    private ws: IWebSocketService
  ) {}

  static getInstance(config?: ServiceConfig): PersistenceServiceProvider {
    if (!PersistenceServiceProvider.instance) {
      PersistenceServiceProvider.instance = new PersistenceServiceProvider(
        config?.adapter || new HttpAdapter(),
        config?.cache || new TanStackCacheService(),
        config?.ws || new BrowserWebSocketService()
      );
    }
    return PersistenceServiceProvider.instance;
  }

  // Cold repositories - no WebSocket
  get clients(): IClientRepository {
    return new ClientRepository(this.adapter, this.cache);
  }

  get projects(): IProjectRepository {
    return new ProjectRepository(this.adapter, this.cache);
  }

  // Hot repositories - with WebSocket
  get extractionJobs(): IExtractionJobRepository {
    return new ExtractionJobRepository(this.adapter, this.cache, this.ws);
  }

  get extractionResults(): IExtractionResultRepository {
    return new ExtractionResultRepository(this.adapter, this.cache, this.ws);
  }
}

export function getPersistenceServiceProvider(): PersistenceServiceProvider {
  return PersistenceServiceProvider.getInstance();
}
```

### Hot vs Cold Wiring

The client core decides implementation based on temperature:

| Domain             | Temperature | Implementation           |
| ------------------ | ----------- | ------------------------ |
| Clients            | Cold        | HTTP + Cache             |
| Projects           | Cold        | HTTP + Cache             |
| Suppliers          | Cold        | HTTP + Cache             |
| Extraction Jobs    | Hot         | HTTP + Cache + WebSocket |
| Extraction Results | Hot         | HTTP + Cache + WebSocket |

---

## Layer 3: Application Layer

### Purpose

UI and application state management

### Location

`apps/frontend`

### Two State Systems

#### System 1: Server State (TanStack Query)

**Managed by:** Persistence layer + TanStack Query

**Owns:**

- All server data (clients, projects, jobs, results)
- HTTP request lifecycle
- Caching strategy
- Background refetching

**Example:**

```typescript
// Component uses persistence layer
const persistence = getPersistenceServiceProvider();

// TanStack Query wraps the repository call
const { data: projects, isLoading } = useQuery(["projects", clientId], () =>
  persistence.projects.findMany({ clientId })
);
```

#### System 2: App/UI State (Redux-like)

**Managed by:** Central state manager with Immer

**Owns:**

- Selected IDs (which project, which job, etc.)
- UI state (panels open/closed, tabs, modals)
- Filters and sorting
- Wizard/multi-step flow state
- Unsaved drafts
- Optimistic UI flags

**Example:**

```typescript
// Redux-like state shape
interface AppState {
  ui: {
    selectedClientId: string | null;
    selectedProjectId: string | null;
    activeExtractionJobId: string | null;
    isExtractionPanelOpen: boolean;
    projectFilters: {
      search: string;
      status: "all" | "active" | "archived";
    };
  };
  drafts: {
    projectDraft: Partial<Project> | null;
    extractionDraft: Partial<ExtractionJob> | null;
  };
}

// Component uses both systems
const selectedProjectId = useAppState((state) => state.ui.selectedProjectId);
const { data: project } = useQuery(["project", selectedProjectId], () =>
  persistence.projects.findById(selectedProjectId!)
);
```

### Key Rule: No Duplication

❌ **Don't do this:**

```typescript
// BAD: Duplicating server data in Redux
interface AppState {
  projects: Project[]; // ❌ Already in TanStack
  clients: Client[]; // ❌ Already in TanStack
}
```

✅ **Do this:**

```typescript
// GOOD: Only IDs and UI state in Redux
interface AppState {
  ui: {
    selectedProjectId: string | null; // ✅ Just the ID
    selectedClientId: string | null; // ✅ Just the ID
  };
}
```

---

## Hot vs Cold Data

### Cold Data Characteristics

- Changes infrequently
- User doesn't need millisecond updates
- Eventual consistency is fine
- Examples: clients, projects, suppliers

### Cold Data Implementation

```typescript
class ColdRepository {
  // HTTP for CRUD
  async findMany(): Promise<T[]> {
    return this.adapter.get("/endpoint");
  }

  // Cache with longer TTL
  async findById(id: string): Promise<T> {
    const cached = await this.cache.get(id);
    if (cached) return cached;

    const data = await this.adapter.get(`/endpoint/${id}`);
    await this.cache.set(id, data, 300); // 5 min TTL
    return data;
  }

  // Updates invalidate cache
  async update(id: string, data: Partial<T>): Promise<T> {
    const updated = await this.adapter.put(`/endpoint/${id}`, data);
    await this.cache.invalidate(id);
    return updated;
  }
}
```

### Hot Data Characteristics

- Realtime/streaming nature
- Progress updates, live results
- UI should feel "live"
- Examples: extraction jobs, extraction results

### Hot Data Implementation

```typescript
class HotRepository {
  constructor(
    private adapter: IDatabaseAdapter,
    private cache: ICacheService,
    private ws: IWebSocketService // ← Key difference
  ) {
    // Subscribe to WebSocket updates
    this.ws.subscribe("channel", this.handleUpdate.bind(this));
  }

  // Initial fetch via HTTP
  async findById(id: string): Promise<T> {
    const cached = await this.cache.get(id);
    if (cached) return cached;

    const data = await this.adapter.get(`/endpoint/${id}`);
    await this.cache.set(id, data, 30); // Short TTL
    return data;
  }

  // WebSocket keeps cache fresh
  private handleUpdate(payload: WebSocketPayload): void {
    if (payload.op === "UPDATE") {
      this.cache.set(payload.data.id, payload.data, 30);
      // TanStack Query automatically re-renders components
    }
  }
}
```

### WebSocket Usage Rules

✅ **WebSocket is:**

- Only wired into hot repositories
- An event source for those repositories
- Used to update the cache/TanStack Query

❌ **WebSocket is NOT:**

- A replacement for HTTP
- Used in cold repositories
- A generic layer everywhere

---

## State Separation

### Server State vs App State

```typescript
// ❌ BAD: Mixing server and app state
interface BadState {
  projects: Project[];           // Server state
  selectedProjectId: string;     // App state
  clients: Client[];             // Server state
  sidebarOpen: boolean;          // App state
}

// ✅ GOOD: Clear separation
interface GoodState {
  ui: {
    selectedProjectId: string;   // App state only
    selectedClientId: string;    // App state only
    sidebarOpen: boolean;        // App state only
    filters: { ... };            // App state only
  };
}

// Server state lives in TanStack Query, accessed via hooks
const { data: projects } = useQuery(['projects'], fetchProjects);
const { data: clients } = useQuery(['clients'], fetchClients);
```

### What Redux-like Store Should Own

✅ **Store owns:**

- `ui.selectedClientId`, `ui.selectedProjectId`
- `ui.inspectionSidebarOpen`, `ui.extractionDetailsExpanded`
- `filters.clientSearch`, `filters.projectStatus`
- `wizard.currentStep`, `wizard.formData`
- `drafts.unsavedProject`, `drafts.unsavedExtraction`

🚫 **Store does NOT own:**

- Full server records (`projects[]`, `clients[]`)
- Anything that comes from the backend
- Anything that TanStack Query already manages

---

## Data Flow Examples

### Example 1: Cold Data - Clients Page

```typescript
// 1. Component mounts
function ClientsPage() {
  // 2. Read UI state from Redux
  const filters = useAppState(state => state.ui.clientFilters);
  const selectedId = useAppState(state => state.ui.selectedClientId);

  // 3. Fetch server data via persistence layer
  const persistence = getPersistenceServiceProvider();
  const { data: clients, isLoading } = useQuery(
    ['clients', filters],
    () => persistence.clients.findMany(filters)
  );

  // 4. User clicks a client
  const handleSelectClient = (clientId: string) => {
    // Update Redux (app state)
    dispatch(UIActions.selectClient(clientId));
  };

  // 5. Render combines server data + app state
  return (
    <div>
      {clients?.map(client => (
        <ClientCard
          key={client.id}
          client={client}  // From TanStack
          isSelected={client.id === selectedId}  // From Redux
          onSelect={handleSelectClient}
        />
      ))}
    </div>
  );
}
```

**Flow:**

1. Component reads filters from Redux
2. Component fetches clients via TanStack + persistence layer
3. User clicks → Redux updates `selectedClientId`
4. Component re-renders with new selection
5. No server data stored in Redux

### Example 2: Hot Data - Extraction Job Progress

```typescript
// 1. Component mounts
function ExtractionJobPanel() {
  // 2. Read UI state from Redux
  const jobId = useAppState(state => state.ui.activeExtractionJobId);
  const isPanelOpen = useAppState(state => state.ui.isExtractionPanelOpen);

  // 3. Fetch job data (hot repository with WebSocket)
  const persistence = getPersistenceServiceProvider();
  const { data: job, isLoading } = useQuery(
    ['extraction-job', jobId],
    () => persistence.extractionJobs.findById(jobId!)
  );

  // 4. WebSocket updates happen automatically
  // - WebSocket receives progress update
  // - Hot repository updates TanStack cache
  // - Component re-renders with new progress

  // 5. User closes panel
  const handleClose = () => {
    dispatch(UIActions.closeExtractionPanel());
  };

  return (
    <Panel isOpen={isPanelOpen} onClose={handleClose}>
      <ProgressBar value={job?.progress} />  {/* From TanStack */}
      <Status>{job?.status}</Status>         {/* From TanStack */}
    </Panel>
  );
}
```

**Flow:**

1. Redux knows which job is active and if panel is open
2. TanStack fetches job data via hot repository
3. WebSocket updates arrive → hot repository updates cache
4. TanStack notifies component → re-render with new data
5. Redux handles panel open/close state

### Example 3: Optimistic Update with Draft

```typescript
function ProjectEditForm({ projectId }: { projectId: string }) {
  // 1. Read server data
  const persistence = getPersistenceServiceProvider();
  const { data: project } = useQuery(
    ['project', projectId],
    () => persistence.projects.findById(projectId)
  );

  // 2. Read draft from Redux
  const draft = useAppState(state => state.drafts.projectDraft);
  const isSaving = useAppState(state => state.ui.isSavingProject);

  // 3. User edits → update draft in Redux
  const handleChange = (field: string, value: any) => {
    dispatch(DraftActions.updateProjectDraft({ [field]: value }));
  };

  // 4. User saves
  const handleSave = async () => {
    // Set saving flag in Redux
    dispatch(UIActions.setSavingProject(true));

    try {
      // Call persistence layer
      await persistence.projects.update(projectId, draft!);

      // Clear draft from Redux
      dispatch(DraftActions.clearProjectDraft());

      // TanStack will refetch automatically
    } catch (error) {
      // Store error in Redux
      dispatch(UIActions.setProjectError(error.message));
    } finally {
      dispatch(UIActions.setSavingProject(false));
    }
  };

  // 5. Render combines server data + draft + UI state
  const displayData = draft || project;

  return (
    <form>
      <input
        value={displayData?.name}
        onChange={(e) => handleChange('name', e.target.value)}
      />
      <button onClick={handleSave} disabled={isSaving}>
        {isSaving ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}
```

**Flow:**

1. TanStack provides original project data
2. Redux stores unsaved draft
3. User edits → Redux draft updates
4. User saves → persistence layer called
5. On success: clear draft, TanStack refetches
6. On error: show error from Redux

---

## Summary

### One-Sentence Summary

**Persistence layer (repos + TanStack + WebSocket) = Single source of truth for server data (hot/cold, cached, streamed).**

**Redux-like central state = Single source of truth for application state (selections, filters, wizards, drafts, UI) that orchestrates how the user moves through that data.**

### Key Takeaways

1. **Three layers:** Contracts → Client Core → Application
2. **Two state systems:** Server state (TanStack) vs App state (Redux)
3. **Hot vs Cold:** Different implementations based on data temperature
4. **No duplication:** Server data stays in TanStack, not Redux
5. **Clear boundaries:** Each layer has distinct responsibilities
6. **WebSocket selective:** Only for hot data, updates TanStack cache
7. **Type-safe:** Full TypeScript from contracts to UI
