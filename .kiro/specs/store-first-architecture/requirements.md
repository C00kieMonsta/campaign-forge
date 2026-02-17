# Requirements Document

## Introduction

This document defines the requirements for implementing a store-first client architecture with a single source of truth for all application state. The architecture establishes a normalized entity store that repositories hydrate and update, eliminating the split between "server state" and "app state". This design provides a simpler mental model where components read from one store, repositories manage data fetching and updates, and WebSockets push realtime changes directly into the store.

## Glossary

- **Store**: Single, normalized state container holding all entities, UI state, drafts, and preferences
- **Entity**: Domain object (Client, Project, ExtractionJob, ExtractionResult) stored in normalized form by ID
- **Repository**: Service that fetches data from backend and hydrates/updates the store
- **Hot Data**: Data that changes frequently and requires realtime updates (e.g., extraction jobs, results)
- **Cold Data**: Data that changes infrequently and can use longer cache TTLs (e.g., clients, projects)
- **Hydration**: Process of loading data from backend into the store
- **Optimistic Update**: Immediately updating the store before server confirmation, with rollback on failure
- **Persistence Service Provider**: Singleton that provides access to all repositories with injected dependencies
- **WebSocket Service**: Real-time bidirectional communication service that pushes updates into the store
- **Cache Service**: Optional background caching layer (e.g., TanStack Query) used internally by repositories
- **Database Adapter**: HTTP client abstraction for backend communication

## Requirements

### Requirement 1: Single Source of Truth

**User Story:** As a developer, I want all application state in one store, so that I have a single mental model for state management without confusion between "server state" and "app state".

#### Acceptance Criteria

1. WHEN the application initializes THEN the system SHALL create a single app store containing entities, UI state, drafts, and preferences
2. WHEN an entity is fetched THEN the system SHALL store it only in the entities slice of the app store
3. WHEN a component needs entity data THEN the system SHALL read it from the entities slice
4. WHEN UI state is needed THEN the system SHALL read it from the ui slice
5. WHEN the store is inspected THEN the system SHALL contain no duplicate entity data across slices

### Requirement 2: Normalized Entity Storage

**User Story:** As a developer, I want entities stored in normalized form by ID, so that updates are efficient and there's no data duplication.

#### Acceptance Criteria

1. WHEN entities are stored THEN the system SHALL organize them by type in Record<string, Entity> structures
2. WHEN an entity is updated THEN the system SHALL update exactly one record in the store
3. WHEN other slices reference entities THEN the system SHALL store only entity IDs, not full entity copies
4. WHEN entities are queried THEN the system SHALL support efficient lookup by ID
5. WHEN entities are listed THEN the system SHALL support filtering via selector functions

### Requirement 3: Repository-Driven Hydration

**User Story:** As a developer, I want repositories to manage data fetching and store updates, so that components don't need to know about HTTP or caching details.

#### Acceptance Criteria

1. WHEN a repository fetches data THEN the system SHALL call the database adapter to retrieve data from backend
2. WHEN data is retrieved THEN the system SHALL normalize it and write it to the entities slice
3. WHEN a repository method completes THEN the system SHALL return the fetched entities to the caller
4. WHEN components need data THEN the system SHALL call repository methods, not HTTP directly
5. WHEN the store is updated by a repository THEN the system SHALL trigger re-renders of subscribed components

### Requirement 4: Optional Internal Caching

**User Story:** As a developer, I want repositories to optionally use caching internally, so that I can optimize performance without changing the store-first architecture.

#### Acceptance Criteria

1. WHEN a repository is configured with a cache service THEN the system SHALL check the cache before making HTTP requests
2. WHEN cached data exists and is fresh THEN the system SHALL hydrate the store from cache and skip HTTP
3. WHEN cached data is stale or missing THEN the system SHALL fetch from HTTP and update both cache and store
4. WHEN a repository is configured without a cache THEN the system SHALL fetch directly from HTTP
5. WHEN cache is used THEN the system SHALL treat it as an implementation detail invisible to components

### Requirement 5: Cold Data Repository Pattern

**User Story:** As a developer, I want cold data repositories to efficiently cache infrequently changing data, so that users experience fast load times.

#### Acceptance Criteria

1. WHEN a cold repository fetches data THEN the system SHALL optionally check cache with a TTL of 300 seconds or longer
2. WHEN cold data is fetched THEN the system SHALL hydrate the entities slice with the results
3. WHEN cold data is updated THEN the system SHALL invalidate related cache entries and update the store
4. WHEN cold data is deleted THEN the system SHALL remove it from both cache and store
5. WHEN a cold repository is created THEN the system SHALL NOT inject WebSocket service

### Requirement 6: Hot Data Repository Pattern

**User Story:** As a developer, I want hot data repositories to receive realtime updates via WebSocket, so that users see live progress without manual refreshing.

#### Acceptance Criteria

1. WHEN a hot repository is initialized THEN the system SHALL subscribe to the appropriate WebSocket channel
2. WHEN a WebSocket update is received THEN the system SHALL update the entities slice directly
3. WHEN the entities slice is updated via WebSocket THEN the system SHALL trigger component re-renders automatically
4. WHEN a hot repository fetches initial data THEN the system SHALL use HTTP with optional short-TTL cache
5. WHEN a hot repository is created THEN the system SHALL receive WebSocket service injection

### Requirement 7: Optimistic Updates with Rollback

**User Story:** As a user, I want UI updates to feel instant, so that the application feels responsive even with network latency.

#### Acceptance Criteria

1. WHEN a repository performs an update THEN the system SHALL read the current entity from the store
2. WHEN an optimistic update is triggered THEN the system SHALL immediately write the optimistic version to the store
3. WHEN the HTTP request succeeds THEN the system SHALL replace the optimistic version with the server response
4. WHEN the HTTP request fails THEN the system SHALL rollback to the previous entity state
5. WHEN a rollback occurs THEN the system SHALL optionally write error state to the ui slice

### Requirement 8: Store Structure and Slices

**User Story:** As a developer, I want a clear store structure with separate slices, so that state is organized and maintainable.

#### Acceptance Criteria

1. WHEN the store is created THEN the system SHALL include an entities slice with all domain entities
2. WHEN the store is created THEN the system SHALL include a ui slice for selections, filters, and loading states
3. WHEN the store is created THEN the system SHALL include a drafts slice for unsaved form data
4. WHEN the store is created THEN the system SHALL include a preferences slice for user settings
5. WHEN slices are defined THEN the system SHALL enforce that only the entities slice contains full entity records

### Requirement 9: Persistence Service Provider

**User Story:** As a developer, I want a single entry point for all repositories, so that I don't need to manually wire dependencies in every component.

#### Acceptance Criteria

1. WHEN the application starts THEN the system SHALL initialize the PersistenceServiceProvider as a singleton
2. WHEN a repository is accessed THEN the system SHALL inject the store, adapter, and appropriate services
3. WHEN a cold repository is created THEN the system SHALL inject adapter, store, and optional cache
4. WHEN a hot repository is created THEN the system SHALL inject adapter, store, WebSocket service, and optional cache
5. WHEN components need data access THEN the system SHALL use getPersistenceServiceProvider() to access repositories

### Requirement 10: React Integration Hooks

**User Story:** As a developer, I want React hooks for reading store state, so that components re-render efficiently when relevant data changes.

#### Acceptance Criteria

1. WHEN a component uses useAppState with a selector THEN the system SHALL re-render only when selected state changes
2. WHEN a component uses useEntity(type, id) THEN the system SHALL return the entity from the entities slice
3. WHEN a component uses useCollection(type, filter) THEN the system SHALL return filtered entities from the entities slice
4. WHEN a component uses useUIState THEN the system SHALL return the ui slice
5. WHEN a component uses useDispatch THEN the system SHALL provide access to the dispatch function

### Requirement 11: WebSocket Integration

**User Story:** As a user, I want to see realtime updates for extraction jobs and results, so that I can monitor progress without refreshing.

#### Acceptance Criteria

1. WHEN the WebSocket service connects THEN the system SHALL establish a connection to the configured URL
2. WHEN a repository subscribes to a channel THEN the system SHALL register a handler for that channel
3. WHEN a WebSocket message arrives THEN the system SHALL route it to the appropriate repository handler
4. WHEN a repository handler processes an update THEN the system SHALL write the updated entity to the store
5. WHEN the WebSocket connection is lost THEN the system SHALL attempt reconnection with exponential backoff

### Requirement 12: Data Flow for Initial Load

**User Story:** As a user, I want pages to load quickly with cached data when available, so that I can start working immediately.

#### Acceptance Criteria

1. WHEN a component mounts THEN the system SHALL call repository methods to fetch needed data
2. WHEN a repository is called THEN the system SHALL check optional cache before HTTP
3. WHEN data is fetched THEN the system SHALL hydrate the entities slice
4. WHEN the entities slice is updated THEN the system SHALL trigger component re-renders
5. WHEN a component reads from the store THEN the system SHALL use selector hooks to access entities

### Requirement 13: Data Flow for Realtime Updates

**User Story:** As a user, I want to see extraction job progress update in realtime, so that I know the current status without manual intervention.

#### Acceptance Criteria

1. WHEN a WebSocket event arrives THEN the system SHALL route it to the subscribed repository
2. WHEN the repository processes the event THEN the system SHALL normalize the payload
3. WHEN the payload is normalized THEN the system SHALL update the entities slice
4. WHEN the entities slice is updated THEN the system SHALL trigger re-renders of components using that entity
5. WHEN multiple updates arrive in quick succession THEN the system SHALL batch store updates to minimize re-renders

### Requirement 14: Immutable State Updates

**User Story:** As a developer, I want immutable state updates, so that state changes are predictable and debuggable.

#### Acceptance Criteria

1. WHEN the store is updated THEN the system SHALL use Immer to ensure immutability
2. WHEN a repository writes to the store THEN the system SHALL create a new state object
3. WHEN the previous state is inspected THEN the system SHALL remain unchanged
4. WHEN Redux DevTools is available THEN the system SHALL integrate with it for debugging
5. WHEN state updates occur THEN the system SHALL track them in the DevTools timeline

### Requirement 15: Type Safety

**User Story:** As a developer, I want compile-time type safety for all store operations, so that I catch errors early.

#### Acceptance Criteria

1. WHEN entities are defined THEN the system SHALL provide TypeScript interfaces in @packages/types
2. WHEN the store is accessed THEN the system SHALL enforce type safety for all slices
3. WHEN repositories are used THEN the system SHALL enforce type safety for parameters and return values
4. WHEN selectors are written THEN the system SHALL infer return types from the store shape
5. WHEN TypeScript compiles THEN the system SHALL enforce strict mode for all packages

### Requirement 16: Package Structure

**User Story:** As a developer, I want clear package boundaries, so that I can import from package roots without deep paths.

#### Acceptance Criteria

1. WHEN the system is built THEN the system SHALL contain a @packages/types package with interfaces and types
2. WHEN the system is built THEN the system SHALL contain a @packages/core-client package with repositories and services
3. WHEN a developer imports from a package THEN the system SHALL allow importing from the package root
4. WHEN packages are built THEN the system SHALL NOT have circular dependencies
5. WHEN a package exports capabilities THEN the system SHALL expose all public APIs through the root index.ts

### Requirement 17: Testing with Fakes

**User Story:** As a developer, I want to test with fake implementations, so that I can verify behavior without hitting the backend.

#### Acceptance Criteria

1. WHEN tests are written THEN the system SHALL provide a FakeDatabaseAdapter with in-memory storage
2. WHEN tests are written THEN the system SHALL provide a FakeWebSocketService with manual event triggering
3. WHEN tests are written THEN the system SHALL provide a FakePersistenceServiceProvider that wires fakes with real repositories
4. WHEN a fake database is created THEN the system SHALL support seeding with test data
5. WHEN tests run THEN the system SHALL use real repository logic with fake services for deterministic behavior

### Requirement 18: Seeding and Test Data

**User Story:** As a developer, I want to seed fake databases with test data, so that I can write assertions against known data.

#### Acceptance Criteria

1. WHEN a FakeDatabaseAdapter is created THEN the system SHALL accept a seed object with entity collections
2. WHEN seed data is provided THEN the system SHALL populate the in-memory database with the entities
3. WHEN repositories query the fake database THEN the system SHALL return seeded entities
4. WHEN repositories filter data THEN the system SHALL apply filters to seeded entities
5. WHEN tests complete THEN the system SHALL allow clearing the fake database for test isolation

### Requirement 19: Repository Testing

**User Story:** As a developer, I want to test repository logic, so that I can verify hydration, caching, and WebSocket integration.

#### Acceptance Criteria

1. WHEN a repository test runs THEN the system SHALL use FakeDatabaseAdapter and a fresh store instance
2. WHEN a repository fetches data THEN the test SHALL verify the entities slice is hydrated correctly
3. WHEN a repository performs an optimistic update THEN the test SHALL verify rollback on failure
4. WHEN a WebSocket event is emitted THEN the test SHALL verify the store is updated
5. WHEN cache is used THEN the test SHALL verify cache hits and misses

### Requirement 20: Error Handling

**User Story:** As a developer, I want consistent error handling, so that errors are caught, logged, and displayed appropriately.

#### Acceptance Criteria

1. WHEN a repository operation fails THEN the system SHALL throw a typed error
2. WHEN a network error occurs THEN the system SHALL attempt retry with exponential backoff
3. WHEN a validation error occurs THEN the system SHALL transform it to a user-friendly message
4. WHEN an error is thrown THEN the system SHALL log it with appropriate context
5. WHEN an optimistic update fails THEN the system SHALL rollback and optionally write error state to ui slice

### Requirement 21: Performance Optimization

**User Story:** As a user, I want the application to load quickly and respond smoothly, so that I can work efficiently.

#### Acceptance Criteria

1. WHEN entities are accessed multiple times THEN the system SHALL serve them from the store without additional fetches
2. WHEN components re-render THEN the system SHALL only re-render when selected state changes
3. WHEN selectors are used THEN the system SHALL memoize results to prevent unnecessary re-renders
4. WHEN WebSocket messages arrive in bursts THEN the system SHALL batch store updates to reduce re-renders
5. WHEN the application bundle is built THEN the system SHALL tree-shake unused code from packages

### Requirement 22: Migration Path

**User Story:** As a developer, I want to migrate existing code incrementally, so that I can refactor without breaking the application.

#### Acceptance Criteria

1. WHEN new packages are created THEN the system SHALL allow existing code to continue using old patterns
2. WHEN a page is migrated THEN the system SHALL use the new architecture without affecting other pages
3. WHEN both old and new patterns coexist THEN the system SHALL NOT have conflicts or duplicate state
4. WHEN a migration is complete for a domain THEN the system SHALL remove old code for that domain
5. WHEN all migrations are complete THEN the system SHALL remove all legacy data access code
