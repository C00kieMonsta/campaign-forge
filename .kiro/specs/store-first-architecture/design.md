# Store-First Architecture Design

## Overview

This design establishes a store-first client architecture that provides a single source of truth for all application state. The architecture eliminates the conceptual split between "server state" and "app state" by using a normalized entity store that repositories hydrate and update. Components read from one store, repositories manage data fetching and updates, and WebSockets push realtime changes directly into the store.

### Key Design Principles

1. **Single Source of Truth**: All application state lives in one Redux store with clearly defined slices
2. **Normalized Storage**: Entities are stored by ID in Record<string, Entity> structures to prevent duplication
3. **Repository Pattern**: Repositories encapsulate data fetching, caching, and store hydration logic
4. **Optional Caching**: TanStack Query can be used internally by repositories as an implementation detail
5. **Realtime Integration**: WebSocket updates flow directly into the store for hot data
6. **Type Safety**: Full TypeScript support with strict mode across all packages
7. **Incremental Migration**: New architecture coexists with existing patterns during transition

### Design Rationale

The current codebase uses React Context (e.g., ClientContext) and TanStack Query hooks scattered throughout components. This creates several issues:
- Duplicate state management patterns (Context + Query)
- Components tightly coupled to data fetching logic
- Difficult to implement optimistic updates consistently
- No clear pattern for realtime WebSocket integration
- State scattered across multiple contexts and query caches

The store-first architecture addresses these by:
- Centralizing all state in a Redux store
- Moving data fetching logic into repositories
- Providing a clear pattern for optimistic updates with rollback
- Enabling WebSocket updates to flow directly into the store
- Simplifying component logic to pure state selection and rendering

## Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     React Components                         │
│  (useEntity, useCollection, useUIState hooks)               │
└────────────────────┬────────────────────────────────────────┘
                     │ read state
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Redux Store (Single Source of Truth)      │
│  ┌──────────────┬──────────────┬──────────────┬──────────┐ │
│  │   entities   │      ui      │    drafts    │   prefs  │ │
│  │  (normalized)│  (selections,│  (unsaved    │  (user   │ │
│  │              │   filters,   │   forms)     │ settings)│ │
│  │              │   loading)   │              │          │ │
│  └──────────────┴──────────────┴──────────────┴──────────┘ │
└────────────────────┬────────────────────────────────────────┘
                     │ write state
                     ▲
┌────────────────────┴────────────────────────────────────────┐
│              PersistenceServiceProvider                      │
│  (Singleton that wires repositories with dependencies)       │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌──────────────────┐    ┌──────────────────┐
│  Cold Repository │    │  Hot Repository  │
│  (Clients,       │    │  (ExtractionJobs,│
│   Projects)      │    │   Results)       │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         │ ┌─────────────────────┤
         │ │                     │
         ▼ ▼                     ▼
┌──────────────────┐    ┌──────────────────┐
│ DatabaseAdapter  │    │ WebSocketService │
│  (HTTP Client)   │    │  (Realtime)      │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│            Backend API                   │
└─────────────────────────────────────────┘

Optional Internal Layer (invisible to components):
┌──────────────────┐
│ TanStack Query   │
│  (Cache Layer)   │
└──────────────────┘
```

### Data Flow Patterns

#### Initial Load (Cold Data)
```
1. Component mounts → calls repository.fetchClients()
2. Repository checks TanStack Query cache (optional)
3. If cache miss → DatabaseAdapter.get('/clients')
4. Repository normalizes response
5. Repository dispatches action to update entities slice
6. Store update triggers component re-render
7. Component reads from store via useEntity hook
```

#### Realtime Update (Hot Data)
```
1. WebSocket message arrives
2. WebSocketService routes to subscribed repository
3. Repository normalizes payload
4. Repository dispatches action to update entities slice
5. Store update triggers component re-render
6. Component reads updated data from store
```

#### Optimistic Update
```
1. User action triggers repository.updateClient(id, changes)
2. Repository reads current entity from store
3. Repository immediately dispatches optimistic update to store
4. UI updates instantly
5. Repository calls DatabaseAdapter.put('/clients/:id', changes)
6. On success: dispatch server response to store
7. On failure: dispatch rollback action with previous state
```

## Components and Interfaces

### Package Structure

```
@packages/
├── types/                    # Shared TypeScript interfaces
│   ├── entities/            # Domain entity types
│   ├── store/               # Store state types
│   └── api/                 # API request/response types
│
├── core-client/             # Core state management and data access
│   ├── store/               # Redux store configuration
│   ├── repositories/        # Data access layer
│   ├── services/            # WebSocket, adapter services
│   ├── hooks/               # React integration hooks
│   └── test-utils/          # Fake implementations for testing
│
├── utils/                   # Existing utilities (unchanged)
└── ui/                      # Existing UI components (unchanged)
```

### Core Interfaces

#### Store State Structure

```typescript
// @packages/types/store/app-state.ts
export interface AppState {
  entities: EntitiesState;
  ui: UIState;
  drafts: DraftsState;
  preferences: PreferencesState;
}

export interface EntitiesState {
  clients: Record<string, Client>;
  projects: Record<string, Project>;
  extractionJobs: Record<string, ExtractionJob>;
  extractionResults: Record<string, ExtractionResult>;
  extractionSchemas: Record<string, ExtractionSchema>;
  files: Record<string, File>;
  suppliers: Record<string, Supplier>;
}

export interface UIState {
  selections: {
    selectedClientId: string | null;
    selectedProjectId: string | null;
    selectedJobId: string | null;
  };
  filters: {
    clientSearch: string;
    projectStatus: string[];
    dateRange: { start: Date | null; end: Date | null };
  };
  loading: {
    clients: boolean;
    projects: boolean;
    jobs: boolean;
  };
  errors: {
    clients: string | null;
    projects: string | null;
    jobs: string | null;
  };
}

export interface DraftsState {
  newClient: Partial<Client> | null;
  newProject: Partial<Project> | null;
  editingClient: { id: string; draft: Partial<Client> } | null;
}

export interface PreferencesState {
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  defaultPageSize: number;
}
```

#### Repository Interface

```typescript
// @packages/core-client/repositories/base-repository.ts
export interface Repository<T extends { id: string }> {
  // Read operations
  getById(id: string): Promise<T | null>;
  getAll(filters?: Record<string, any>): Promise<T[]>;
  
  // Write operations
  create(data: Omit<T, 'id'>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
  
  // Optimistic updates
  updateOptimistic(id: string, data: Partial<T>): Promise<T>;
}

export interface ColdRepository<T extends { id: string }> extends Repository<T> {
  // Cold repositories use longer cache TTLs
  // No WebSocket subscription
}

export interface HotRepository<T extends { id: string }> extends Repository<T> {
  // Hot repositories subscribe to WebSocket channels
  subscribe(): void;
  unsubscribe(): void;
}
```

#### Database Adapter Interface

```typescript
// @packages/core-client/services/database-adapter.ts
export interface DatabaseAdapter {
  get<T>(path: string, params?: Record<string, any>): Promise<T>;
  post<T>(path: string, data: any): Promise<T>;
  put<T>(path: string, data: any): Promise<T>;
  patch<T>(path: string, data: any): Promise<T>;
  delete(path: string): Promise<void>;
}

export class HttpDatabaseAdapter implements DatabaseAdapter {
  constructor(private baseUrl: string, private authToken: () => string | null) {}
  
  async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    // Implementation using fetch with auth headers
  }
  
  // ... other methods
}
```

#### WebSocket Service Interface

```typescript
// @packages/core-client/services/websocket-service.ts
export interface WebSocketService {
  connect(url: string): void;
  disconnect(): void;
  subscribe(channel: string, handler: (data: any) => void): void;
  unsubscribe(channel: string): void;
  send(channel: string, data: any): void;
  isConnected(): boolean;
}

export class RealtimeWebSocketService implements WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<(data: any) => void>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  connect(url: string): void {
    // WebSocket connection with exponential backoff
  }
  
  subscribe(channel: string, handler: (data: any) => void): void {
    // Register handler for channel
  }
  
  // ... other methods
}
```

#### Persistence Service Provider

```typescript
// @packages/core-client/persistence/persistence-service-provider.ts
export class PersistenceServiceProvider {
  private static instance: PersistenceServiceProvider | null = null;
  
  private constructor(
    private store: Store<AppState>,
    private adapter: DatabaseAdapter,
    private wsService: WebSocketService,
    private queryClient?: QueryClient // Optional TanStack Query
  ) {}
  
  static initialize(config: {
    store: Store<AppState>;
    adapter: DatabaseAdapter;
    wsService: WebSocketService;
    queryClient?: QueryClient;
  }): void {
    if (PersistenceServiceProvider.instance) {
      throw new Error('PersistenceServiceProvider already initialized');
    }
    PersistenceServiceProvider.instance = new PersistenceServiceProvider(
      config.store,
      config.adapter,
      config.wsService,
      config.queryClient
    );
  }
  
  static getInstance(): PersistenceServiceProvider {
    if (!PersistenceServiceProvider.instance) {
      throw new Error('PersistenceServiceProvider not initialized');
    }
    return PersistenceServiceProvider.instance;
  }
  
  // Repository getters
  get clients(): ClientRepository {
    return new ClientRepository(this.store, this.adapter, this.queryClient);
  }
  
  get projects(): ProjectRepository {
    return new ProjectRepository(this.store, this.adapter, this.queryClient);
  }
  
  get extractionJobs(): ExtractionJobRepository {
    return new ExtractionJobRepository(
      this.store,
      this.adapter,
      this.wsService,
      this.queryClient
    );
  }
  
  get extractionResults(): ExtractionResultRepository {
    return new ExtractionResultRepository(
      this.store,
      this.adapter,
      this.wsService,
      this.queryClient
    );
  }
}

// Convenience function
export function getPersistenceServiceProvider(): PersistenceServiceProvider {
  return PersistenceServiceProvider.getInstance();
}
```

## Data Models

### Entity Normalization

Entities are stored in a flat structure by ID to prevent duplication and enable efficient updates:

```typescript
// Before normalization (API response)
{
  id: "client-1",
  name: "Acme Corp",
  projects: [
    { id: "proj-1", name: "Project A", clientId: "client-1" },
    { id: "proj-2", name: "Project B", clientId: "client-1" }
  ]
}

// After normalization (in store)
entities: {
  clients: {
    "client-1": { id: "client-1", name: "Acme Corp", projectIds: ["proj-1", "proj-2"] }
  },
  projects: {
    "proj-1": { id: "proj-1", name: "Project A", clientId: "client-1" },
    "proj-2": { id: "proj-2", name: "Project B", clientId: "client-1" }
  }
}
```

### Entity Relationships

```typescript
// @packages/types/entities/relationships.ts

// One-to-Many: Client has many Projects
export interface Client {
  id: string;
  name: string;
  projectIds: string[]; // References to projects
  // ... other fields
}

export interface Project {
  id: string;
  name: string;
  clientId: string; // Reference to parent client
  // ... other fields
}

// One-to-Many: Project has many ExtractionJobs
export interface Project {
  id: string;
  name: string;
  clientId: string;
  extractionJobIds: string[]; // References to jobs
}

export interface ExtractionJob {
  id: string;
  projectId: string; // Reference to parent project
  status: 'pending' | 'processing' | 'completed' | 'failed';
  // ... other fields
}

// One-to-Many: ExtractionJob has many ExtractionResults
export interface ExtractionJob {
  id: string;
  projectId: string;
  extractionResultIds: string[]; // References to results
}

export interface ExtractionResult {
  id: string;
  jobId: string; // Reference to parent job
  data: Record<string, any>;
  // ... other fields
}
```

### Selector Patterns

```typescript
// @packages/core-client/store/selectors.ts

// Select single entity
export const selectClientById = (state: AppState, id: string): Client | null => {
  return state.entities.clients[id] || null;
};

// Select collection with filter
export const selectClientsBySearch = (
  state: AppState,
  searchTerm: string
): Client[] => {
  const clients = Object.values(state.entities.clients);
  if (!searchTerm) return clients;
  
  const term = searchTerm.toLowerCase();
  return clients.filter(c => 
    c.name.toLowerCase().includes(term) ||
    c.contactEmail?.toLowerCase().includes(term)
  );
};

// Select with relationships
export const selectProjectsForClient = (
  state: AppState,
  clientId: string
): Project[] => {
  const client = state.entities.clients[clientId];
  if (!client) return [];
  
  return client.projectIds
    .map(id => state.entities.projects[id])
    .filter(Boolean);
};

// Select UI state
export const selectSelectedClient = (state: AppState): Client | null => {
  const clientId = state.ui.selections.selectedClientId;
  return clientId ? state.entities.clients[clientId] || null : null;
};
```

