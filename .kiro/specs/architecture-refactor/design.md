# Architecture Refactor Design Document

## Overview

This design document outlines the three-layer architecture for refactoring the client-side codebase. The architecture separates concerns into:

1. **Layer 1 (Contracts)**: Pure TypeScript types and interfaces in `@packages/types`
2. **Layer 2 (Client Core)**: Concrete implementations in `@packages/core-client`
3. **Layer 3 (Application)**: UI components and state management in `apps/frontend`

The design emphasizes:

- Clear separation of concerns with no circular dependencies
- Hot vs cold data classification with appropriate caching strategies
- Server state (TanStack Query) vs app state (Redux-like manager) separation
- Type safety and reusability across the entire codebase
- Incremental migration path for existing code

## Architecture Layers

### Layer 1: Contracts (@packages/types)

**Purpose**: Define the "what" - pure TypeScript interfaces and types without implementation

**Key Principles**:

- No runtime dependencies
- No implementation logic
- Immutable contracts
- Clear domain boundaries
- All public APIs exported from root index

**Package Structure**:

```
@packages/types/
├── src/
│   ├── entities/
│   │   ├── client.types.ts
│   │   ├── project.types.ts
│   │   ├── extraction.types.ts
│   │   ├── supplier.types.ts
│   │   ├── schema.types.ts
│   │   └── index.ts
│   ├── contracts/
│   │   ├── base.contract.ts
│   │   ├── client.contract.ts
│   │   ├── project.contract.ts
│   │   ├── extraction.contract.ts
│   │   ├── supplier.contract.ts
│   │   └── index.ts
│   ├── services/
│   │   ├── cache.interface.ts
│   │   ├── websocket.interface.ts
│   │   ├── adapter.interface.ts
│   │   └── index.ts
│   ├── metadata/
│   │   ├── temperature.ts
│   │   └── index.ts
│   ├── errors/
│   │   ├── app-error.ts
│   │   └── index.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

**Key Contracts**:

1. **Base Repository Interface**:

```typescript
export interface IBaseRepository<T, TCreate, TUpdate> {
  findById(id: string): Promise<T | null>;
  findMany(filter?: Partial<T>): Promise<T[]>;
  create(data: TCreate): Promise<T>;
  update(id: string, data: TUpdate): Promise<T>;
  delete(id: string): Promise<void>;
}
```

2. **Data Temperature Metadata**:

```typescript
export type DataTemperature = "hot" | "cold";
export interface RepositoryMetadata {
  temperature: DataTemperature;
  description: string;
}
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

3. **Service Interfaces**:

```typescript
export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  invalidate(key: string): Promise<void>;
  invalidatePattern(pattern: string): Promise<void>;
}

export interface IWebSocketService {
  connect(url: string): Promise<void>;
  subscribe(channel: string, handler: WebSocketHandler): void;
  unsubscribe(channel: string, handler: WebSocketHandler): void;
  disconnect(): Promise<void>;
}

export interface IDatabaseAdapter {
  get<T>(path: string, params?: any): Promise<T>;
  post<T>(path: string, data: any): Promise<T>;
  put<T>(path: string, data: any): Promise<T>;
  delete<T>(path: string): Promise<T>;
}
```

### Layer 2: Client Core (@packages/core-client)

**Purpose**: Implement contracts for web clients with dependency injection

**Key Principles**:

- Dependency injection for all services
- Hot vs cold repository patterns
- Service composition
- Platform abstraction

**Package Structure**:

```
@packages/core-client/
├── src/
│   ├── services/
│   │   ├── cache/
│   │   │   ├── tanstack-cache.service.ts
│   │   │   ├── memory-cache.service.ts
│   │   │   └── index.ts
│   │   ├── websocket/
│   │   │   ├── browser-websocket.service.ts
│   │   │   ├── mock-websocket.service.ts
│   │   │   └── index.ts
│   │   ├── persistence/
│   │   │   ├── repositories/
│   │   │   │   ├── client.repository.ts
│   │   │   │   ├── project.repository.ts
│   │   │   │   ├── extraction-job.repository.ts
│   │   │   │   ├── extraction-result.repository.ts
│   │   │   │   └── index.ts
│   │   │   ├── base-cold.repository.ts
│   │   │   ├── base-hot.repository.ts
│   │   │   └── index.ts
│   │   └── state/
│   │       ├── state-manager.ts
│   │       ├── slices/
│   │       │   ├── ui.slice.ts
│   │       │   ├── drafts.slice.ts
│   │       │   ├── preferences.slice.ts
│   │       │   └── index.ts
│   │       └── index.ts
│   ├── adapters/
│   │   ├── http.adapter.ts
│   │   └── index.ts
│   ├── providers/
│   │   ├── persistence.provider.ts
│   │   └── index.ts
│   ├── hooks/
│   │   ├── use-app-state.ts
│   │   ├── use-dispatch.ts
│   │   ├── use-ui-state.ts
│   │   ├── use-drafts.ts
│   │   └── index.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

**Repository Implementation Pattern**:

Cold repositories use HTTP + Cache:

```typescript
export class ClientRepository implements IClientRepository {
  constructor(
    private adapter: IDatabaseAdapter,
    private cache: ICacheService
  ) {}

  async findMany(filter?: Partial<Client>): Promise<Client[]> {
    const cacheKey = `clients:${JSON.stringify(filter)}`;
    const cached = await this.cache.get<Client[]>(cacheKey);
    if (cached) return cached;

    const clients = await this.adapter.get<Client[]>("/clients", filter);
    await this.cache.set(cacheKey, clients, 300); // 5 min TTL
    return clients;
  }
}
```

Hot repositories use HTTP + Cache + WebSocket:

```typescript
export class ExtractionJobRepository implements IExtractionJobRepository {
  constructor(
    private adapter: IDatabaseAdapter,
    private cache: ICacheService,
    private ws: IWebSocketService
  ) {
    this.ws.subscribe("extraction_jobs", this.handleRealtimeUpdate.bind(this));
  }

  async findById(id: string): Promise<ExtractionJob | null> {
    const cacheKey = `extraction_job:${id}`;
    const cached = await this.cache.get<ExtractionJob>(cacheKey);
    if (cached) return cached;

    const job = await this.adapter.get<ExtractionJob>(`/extraction/jobs/${id}`);
    await this.cache.set(cacheKey, job, 30); // 30 sec TTL
    return job;
  }

  private handleRealtimeUpdate(payload: WebSocketPayload): void {
    if (payload.op === "UPDATE") {
      const cacheKey = `extraction_job:${payload.data.id}`;
      this.cache.set(cacheKey, payload.data, 30);
    }
  }
}
```

**Persistence Service Provider**:

```typescript
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

  get clients(): IClientRepository {
    return new ClientRepository(this.adapter, this.cache);
  }

  get projects(): IProjectRepository {
    return new ProjectRepository(this.adapter, this.cache);
  }

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

### Layer 3: Application (@apps/frontend)

**Purpose**: UI components and state management

**Two State Systems**:

1. **Server State (TanStack Query)**:
   - Manages all server data (clients, projects, jobs, results)
   - HTTP request lifecycle
   - Caching strategy
   - Background refetching

2. **App State (Redux-like)**:
   - Selected IDs (which project, which job)
   - UI state (panels open/closed, tabs, modals)
   - Filters and sorting
   - Wizard/multi-step flow state
   - Unsaved drafts
   - Optimistic UI flags

**App State Shape**:

```typescript
interface AppState {
  ui: {
    selectedClientId: string | null;
    selectedProjectId: string | null;
    activeExtractionJobId: string | null;
    isExtractionPanelOpen: boolean;
    isSidebarCollapsed: boolean;
    clientFilters: { search: string; status: string };
    projectFilters: { search: string; status: string };
    isLoading: Record<string, boolean>;
  };
  drafts: {
    projectDraft: Partial<Project> | null;
    extractionJobDraft: Partial<ExtractionJob> | null;
    wizardStep: number;
    formErrors: Record<string, string>;
  };
  preferences: {
    theme: "light" | "dark";
    language: string;
    timezone: string;
  };
}
```

**Component Integration Example**:

```typescript
function ProjectsPage() {
  // Read UI state from Redux
  const filters = useAppState(state => state.ui.projectFilters);
  const selectedId = useAppState(state => state.ui.selectedProjectId);

  // Fetch server data via persistence layer + TanStack Query
  const persistence = getPersistenceServiceProvider();
  const { data: projects, isLoading } = useQuery(
    ['projects', filters],
    () => persistence.projects.findMany(filters)
  );

  // Dispatch actions
  const dispatch = useDispatch();
  const handleSelectProject = (id: string) => {
    dispatch(UIActions.selectProject(id));
  };

  return (
    <div>
      {projects?.map(project => (
        <ProjectCard
          key={project.id}
          project={project}
          isSelected={project.id === selectedId}
          onSelect={handleSelectProject}
        />
      ))}
    </div>
  );
}
```

## Data Flow Patterns

### Cold Data Flow

```
Component → useAppState (filters) → useQuery → Repository → HTTP → Cache → Component
```

### Hot Data Flow

```
Component → useAppState (selection) → useQuery → Repository → HTTP → Cache → Component
                                                                    ↑
                                                            WebSocket Update
```

### Optimistic Update Flow

```
Component → useAppState (draft) → User saves → Repository.update() →
  Success: Clear draft + Invalidate cache → Component re-renders
  Failure: Keep draft + Show error → User can retry
```

## Service Implementations

### Cache Service (TanStack)

- Integrates with TanStack Query
- Supports TTL-based expiration
- Pattern-based invalidation
- LRU eviction for large datasets

### WebSocket Service

- Single connection per client
- Channel-based subscriptions
- Exponential backoff reconnection
- Message routing to handlers

### HTTP Adapter

- Configurable timeout
- Request/response interceptors
- Error transformation
- Query parameter encoding

## State Management

### State Manager (Immer-based)

- Immutable state updates
- Action dispatch routing
- Listener subscriptions
- Redux DevTools integration
- localStorage persistence

### State Slices

- UI slice: selections, panels, filters, loading
- Drafts slice: unsaved changes, form state
- Preferences slice: user preferences

### React Hooks

- `useAppState(selector)`: Subscribe to state changes
- `useDispatch()`: Access dispatch function
- `useUIState()`: Convenience hook for UI state
- `useDrafts()`: Convenience hook for drafts
- `useLoading()`: Convenience hook for loading states

## Error Handling

**Error Types**:

- `NetworkError`: HTTP/WebSocket failures
- `ValidationError`: Input validation failures
- `NotFoundError`: Resource not found
- `UnauthorizedError`: Authentication failures
- `ConflictError`: Data conflicts

**Error Handling Strategy**:

- Retry with exponential backoff for transient errors
- Transform to user-friendly messages
- Log with context for debugging
- Error boundaries for component errors

## Testing Strategy

**Unit Tests**:

- Repository methods with mock services
- State manager reducers
- Hook behavior
- Service implementations

**Integration Tests**:

- Full data flow from component to backend
- State synchronization
- Cache invalidation
- WebSocket updates

**Test Utilities**:

- Mock implementations of all services
- Test state manager setup
- Query client configuration
- WebSocket event simulation

## Performance Considerations

**Caching Strategy**:

- Cold data: 5-minute TTL, aggressive caching
- Hot data: 30-second TTL, frequent updates
- Pattern-based invalidation for related data
- LRU eviction for memory management

**Bundle Optimization**:

- Tree-shaking of unused exports
- Code splitting for lazy loading
- Type stripping in production
- Compression (gzip/brotli)

**Rendering Optimization**:

- Selector memoization
- Component re-render only on relevant state changes
- Batch WebSocket updates
- Lazy component loading

## Type Consolidation

**Migration from @packages/utils**:

1. Audit existing types in utils
2. Migrate entity types to @packages/types/entities
3. Migrate database types to @packages/types/entities
4. Migrate schema types to @packages/types/entities
5. Update all imports across codebase
6. Remove duplicate definitions from utils

**Export Strategy**:

- All types exported from @packages/types root index
- All services exported from @packages/core-client root index
- Clean import paths: `import { Client } from '@packages/types'`

## Migration Path

**Phase 1**: Create packages and migrate types
**Phase 2**: Implement core services (cache, WebSocket, HTTP)
**Phase 3**: Implement repositories
**Phase 4**: Implement state management
**Phase 5**: Integrate into frontend
**Phase 6**: Migrate pages incrementally
**Phase 7**: Remove legacy code

**Coexistence Strategy**:

- Old and new patterns can coexist
- Feature flags for gradual rollout
- No conflicts between systems
- Clear deprecation path

## Fake Implementations for Testing

The architecture includes fake implementations that use real repository code with in-memory storage. This enables comprehensive testing without backend dependencies.

### FakeDatabase

In-memory implementation of the database adapter that:

- Stores data in a Map
- Supports CRUD operations
- Supports querying and filtering
- Triggers listeners on data changes
- Can be seeded with test data

### FakeCacheService

In-memory cache implementation that:

- Stores cached values
- Supports TTL-based expiration
- Supports pattern-based invalidation
- Tracks cache hits and misses

### FakeWebSocketService

Mock WebSocket implementation that:

- Simulates connection establishment
- Allows manual event triggering
- Tracks subscriptions
- Supports reconnection simulation

### FakePersistenceProvider

Factory that creates a complete testing environment:

- Uses real repository implementations
- Injects fake services
- Pre-seeds with standard test data
- Returns provider + db + testData for assertions

### StandardTestData

Pre-seeded test data including:

- Test clients
- Test projects
- Test extraction jobs
- Test extraction results
- All with predictable IDs for assertions

## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Cache Consistency for Cold Data

_For any_ cold data repository and any cache key, if data is fetched and cached, subsequent fetches with the same key should return identical data until cache expiration.
**Validates: Requirements 5.1, 5.2, 5.3**

### Property 2: WebSocket Updates Invalidate Cache

_For any_ hot data repository and any WebSocket update, when an update is received for a cached item, the cache should be updated with the new data within 100ms.
**Validates: Requirements 6.2, 6.3**

### Property 3: Repository Temperature Determines Wiring

_For any_ repository created via PersistenceServiceProvider, if the domain is classified as hot, the repository should receive WebSocket service injection; if cold, it should not.
**Validates: Requirements 4.2, 4.3**

### Property 4: State Separation - No Server Data in App State

_For any_ app state instance, the state should never contain full server entity records (projects[], clients[], etc.), only IDs and UI state.
**Validates: Requirements 11.1, 11.5**

### Property 5: Immutable State Updates

_For any_ state update via dispatch, the previous state object should remain unchanged, and a new state object should be created with the updates applied.
**Validates: Requirements 12.1**

### Property 6: Action Type Routing

_For any_ action dispatched, the system should route it to exactly one registered reducer for that action type.
**Validates: Requirements 12.2, 13.5**

### Property 7: Selector Memoization

_For any_ component using useAppState with the same selector, if the selected state hasn't changed, the component should not re-render.
**Validates: Requirements 14.1, 14.5**

### Property 8: Draft Persistence

_For any_ draft stored in app state, if the application is reloaded, the draft should be restored from localStorage.
**Validates: Requirements 12.5, 17.5**

### Property 9: Cache TTL Enforcement

_For any_ cached item with a TTL, after the TTL expires, the item should be automatically invalidated and removed from cache.
**Validates: Requirements 4.4, 4.5**

### Property 10: Package Export Completeness

_For any_ public API in @packages/types or @packages/core-client, it should be exported from the package root index.ts file.
**Validates: Requirements 1.3, 1.5**
