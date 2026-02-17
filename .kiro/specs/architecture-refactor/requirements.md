# Requirements Document

## Introduction

This document defines the requirements for refactoring the client-side architecture into a three-layer system with clear separation of concerns. The refactor aims to improve developer experience, maintainability, and scalability by establishing contracts (Layer 1), implementing those contracts for web clients (Layer 2), and separating server state from application state (Layer 3).

## Glossary

- **Layer 1 (Contracts)**: Pure TypeScript types and interfaces defining the "what" without implementation
- **Layer 2 (Client Core)**: Concrete implementations of contracts for specific platforms (web, mobile, etc.)
- **Layer 3 (Application)**: UI components and application state management
- **Hot Data**: Data that changes frequently and requires realtime updates (e.g., extraction jobs, results)
- **Cold Data**: Data that changes infrequently and can use longer cache TTLs (e.g., clients, projects)
- **Repository**: A service that provides data access operations for a specific domain entity
- **Persistence Service Provider**: A singleton that provides access to all repositories
- **Server State**: Data fetched from the backend, managed by TanStack Query
- **App State**: UI and interaction state, managed by Redux-like state manager
- **TanStack Query**: React library for managing server state and caching
- **WebSocket**: Real-time bidirectional communication protocol for hot data updates

## Requirements

### Requirement 1: Package Structure and Exports

**User Story:** As a developer, I want clear package boundaries with clean exports, so that I can import from package roots without drilling into deep paths.

#### Acceptance Criteria

1. WHEN the system is built THEN the system SHALL contain a `@packages/types` package with only TypeScript types and interfaces
2. WHEN the system is built THEN the system SHALL contain a `@packages/core-client` package with repository implementations and services
3. WHEN a developer imports from a package THEN the system SHALL allow importing from the package root (e.g., `@packages/types`)
4. WHEN packages are built THEN the system SHALL NOT have circular dependencies between packages
5. WHEN a package exports capabilities THEN the system SHALL expose all public APIs through the root `index.ts` file

### Requirement 2: Existing Capability Audit and Refactor

**User Story:** As a developer, I want to identify and refactor all existing data access patterns, so that the new architecture leverages and improves upon current capabilities.

#### Acceptance Criteria

1. WHEN existing data access code is audited THEN the system SHALL identify all entity types currently in use
2. WHEN existing utilities are audited THEN the system SHALL identify reusable functions to migrate to appropriate packages
3. WHEN existing API calls are audited THEN the system SHALL map them to repository methods in the new architecture
4. WHEN existing state management is audited THEN the system SHALL classify state as server state or app state
5. WHEN the audit is complete THEN the system SHALL document all capabilities to be preserved in the new architecture

### Requirement 3: Contract Definitions

**User Story:** As a developer, I want type-safe contracts for all data operations, so that I get compile-time errors when using repositories incorrectly.

#### Acceptance Criteria

1. WHEN a developer defines a new entity THEN the system SHALL require a corresponding interface in `@packages/types/entities`
2. WHEN a developer creates a repository THEN the system SHALL require implementing the `IBaseRepository` interface
3. WHEN a repository method is called THEN the system SHALL enforce type safety for parameters and return values
4. WHEN a new domain is added THEN the system SHALL require defining its temperature metadata as hot or cold
5. WHEN TypeScript compiles THEN the system SHALL enforce strict mode for all type packages

### Requirement 4: Data Temperature Classification

**User Story:** As a developer, I want automatic classification of data as hot or cold, so that the system applies appropriate caching and update strategies.

#### Acceptance Criteria

1. WHEN a domain is defined in metadata THEN the system SHALL classify it as either hot or cold temperature
2. WHEN a cold repository is created THEN the system SHALL NOT receive WebSocket service injection
3. WHEN a hot repository is created THEN the system SHALL receive WebSocket service injection
4. WHEN cold data is cached THEN the system SHALL use a TTL of 300 seconds or longer
5. WHEN hot data is cached THEN the system SHALL use a TTL of 30 seconds or shorter

### Requirement 5: Cold Data Repository Implementation

**User Story:** As a developer, I want cold data repositories to use HTTP and caching, so that infrequently changing data loads quickly without unnecessary network requests.

#### Acceptance Criteria

1. WHEN a cold repository fetches data THEN the system SHALL check the cache before making HTTP requests
2. WHEN cached cold data exists THEN the system SHALL return cached data without making HTTP requests
3. WHEN cold data is fetched from HTTP THEN the system SHALL cache the result with appropriate TTL
4. WHEN cold data is updated THEN the system SHALL invalidate related cache entries
5. WHEN cold data is deleted THEN the system SHALL invalidate related cache entries

### Requirement 6: Hot Data Repository Implementation

**User Story:** As a developer, I want hot data repositories to receive realtime updates, so that users see progress and changes immediately without manual refreshing.

#### Acceptance Criteria

1. WHEN a hot repository is initialized THEN the system SHALL subscribe to the appropriate WebSocket channel
2. WHEN a WebSocket update is received THEN the system SHALL update the cache with the new data
3. WHEN cached hot data is updated via WebSocket THEN the system SHALL notify TanStack Query to trigger component re-renders
4. WHEN a hot repository fetches data initially THEN the system SHALL use HTTP with short cache TTL
5. WHEN a WebSocket connection is lost THEN the system SHALL attempt reconnection with exponential backoff

### Requirement 7: Persistence Service Provider

**User Story:** As a developer, I want a single entry point for all data access, so that I don't need to manually wire up repositories in every component.

#### Acceptance Criteria

1. WHEN the application starts THEN the system SHALL initialize the PersistenceServiceProvider as a singleton
2. WHEN a component needs data access THEN the system SHALL provide access via `getPersistenceServiceProvider()`
3. WHEN a repository is accessed THEN the system SHALL lazily instantiate it on first access
4. WHEN the PersistenceServiceProvider is configured THEN the system SHALL inject appropriate services based on data temperature
5. WHEN a developer accesses a repository property THEN the system SHALL return a fully typed repository interface

### Requirement 8: Cache Service Implementation

**User Story:** As a developer, I want a flexible caching layer, so that I can swap cache implementations for different environments (browser, testing, server).

#### Acceptance Criteria

1. WHEN the cache service is used THEN the system SHALL implement the `ICacheService` interface
2. WHEN data is cached THEN the system SHALL support optional TTL configuration
3. WHEN cache invalidation is requested THEN the system SHALL support pattern-based invalidation
4. WHEN TanStack Query is used THEN the system SHALL provide a `TanStackCacheService` implementation
5. WHEN tests are run THEN the system SHALL provide a `MemoryCacheService` implementation

### Requirement 9: WebSocket Service Implementation

**User Story:** As a developer, I want reliable WebSocket connections, so that realtime updates work consistently even with network interruptions.

#### Acceptance Criteria

1. WHEN the WebSocket service connects THEN the system SHALL establish a connection to the configured URL
2. WHEN a repository subscribes to a channel THEN the system SHALL register the handler and send a subscription message
3. WHEN a WebSocket message is received THEN the system SHALL route it to all registered handlers for that channel
4. WHEN the WebSocket connection closes THEN the system SHALL attempt reconnection with exponential backoff
5. WHEN reconnection attempts exceed the maximum THEN the system SHALL stop attempting and log an error

### Requirement 10: HTTP Adapter Implementation

**User Story:** As a developer, I want a reliable HTTP client, so that API requests handle errors gracefully and include proper timeouts.

#### Acceptance Criteria

1. WHEN an HTTP request is made THEN the system SHALL include a configurable timeout
2. WHEN an HTTP request times out THEN the system SHALL abort the request and throw a timeout error
3. WHEN an HTTP response has a non-2xx status THEN the system SHALL throw an appropriate error
4. WHEN query parameters are provided THEN the system SHALL properly encode them in the URL
5. WHEN request/response interceptors are configured THEN the system SHALL apply them to all requests

### Requirement 11: State Separation

**User Story:** As a developer, I want clear separation between server state and app state, so that I don't duplicate data and create synchronization bugs.

#### Acceptance Criteria

1. WHEN server data is fetched THEN the system SHALL store it only in TanStack Query cache
2. WHEN UI state is updated THEN the system SHALL store it only in the Redux-like state manager
3. WHEN a component needs server data THEN the system SHALL access it via TanStack Query hooks
4. WHEN a component needs UI state THEN the system SHALL access it via app state hooks
5. WHEN the app state is defined THEN the system SHALL NOT include any server entity data

### Requirement 12: App State Management

**User Story:** As a developer, I want a Redux-like state manager with immutability, so that state updates are predictable and debuggable.

#### Acceptance Criteria

1. WHEN state is updated THEN the system SHALL use Immer to ensure immutability
2. WHEN an action is dispatched THEN the system SHALL route it to the appropriate registered reducer
3. WHEN state changes THEN the system SHALL notify all subscribed listeners
4. WHEN Redux DevTools is available THEN the system SHALL integrate with it for debugging
5. WHEN the application loads THEN the system SHALL restore persisted state from localStorage

### Requirement 13: State Slices and Actions

**User Story:** As a developer, I want organized state slices with type-safe actions, so that state management is maintainable and scalable.

#### Acceptance Criteria

1. WHEN UI state is updated THEN the system SHALL use actions from the UI slice
2. WHEN draft data is managed THEN the system SHALL use actions from the drafts slice
3. WHEN user preferences are updated THEN the system SHALL use actions from the preferences slice
4. WHEN an action is created THEN the system SHALL enforce type safety for the payload
5. WHEN a reducer is registered THEN the system SHALL associate it with a specific action type

### Requirement 14: React Integration Hooks

**User Story:** As a developer, I want React hooks for accessing state, so that components re-render efficiently when relevant state changes.

#### Acceptance Criteria

1. WHEN a component uses `useAppState` THEN the system SHALL re-render only when selected state changes
2. WHEN a component uses `useDispatch` THEN the system SHALL provide access to the dispatch function
3. WHEN a component uses convenience hooks THEN the system SHALL provide both state and action dispatchers
4. WHEN state updates occur THEN the system SHALL use `useSyncExternalStore` for React 18 compatibility
5. WHEN selectors are used THEN the system SHALL memoize results to prevent unnecessary re-renders

### Requirement 15: Cold Data Flow

**User Story:** As a user, I want to view client and project data quickly, so that I can navigate the application without waiting for slow network requests.

#### Acceptance Criteria

1. WHEN a component requests cold data THEN the system SHALL check the cache before making HTTP requests
2. WHEN cached cold data exists and is fresh THEN the system SHALL return it immediately without HTTP requests
3. WHEN cold data is not cached THEN the system SHALL fetch it via HTTP and cache the result
4. WHEN cold data is updated THEN the system SHALL invalidate the cache and refetch
5. WHEN a component unmounts THEN the system SHALL keep cached cold data for subsequent mounts

### Requirement 16: Hot Data Flow

**User Story:** As a user, I want to see extraction job progress in realtime, so that I know the current status without manually refreshing.

#### Acceptance Criteria

1. WHEN a component requests hot data THEN the system SHALL fetch initial data via HTTP
2. WHEN hot data is fetched THEN the system SHALL cache it with a short TTL
3. WHEN a WebSocket update arrives for hot data THEN the system SHALL update the cache immediately
4. WHEN the cache is updated via WebSocket THEN the system SHALL trigger component re-renders automatically
5. WHEN a component unmounts THEN the system SHALL maintain the WebSocket subscription for other components

### Requirement 17: Optimistic Updates with Drafts

**User Story:** As a user, I want to edit forms without losing my changes, so that I can save my work even if I navigate away temporarily.

#### Acceptance Criteria

1. WHEN a user edits a form THEN the system SHALL store changes in the drafts state slice
2. WHEN a user saves a draft THEN the system SHALL call the persistence layer to update the server
3. WHEN a save succeeds THEN the system SHALL clear the draft and invalidate TanStack Query cache
4. WHEN a save fails THEN the system SHALL keep the draft and display an error message
5. WHEN a user navigates away with unsaved changes THEN the system SHALL preserve the draft in state

### Requirement 18: Error Handling

**User Story:** As a developer, I want consistent error handling, so that errors are caught, logged, and displayed appropriately to users.

#### Acceptance Criteria

1. WHEN a repository operation fails THEN the system SHALL throw a typed error
2. WHEN a network error occurs THEN the system SHALL attempt retry with exponential backoff
3. WHEN a validation error occurs THEN the system SHALL transform it to a user-friendly message
4. WHEN an error is thrown THEN the system SHALL log it with appropriate context
5. WHEN a component encounters an error THEN the system SHALL catch it with an error boundary

### Requirement 19: Testing Support

**User Story:** As a developer, I want to easily test components and services, so that I can ensure code quality and prevent regressions.

#### Acceptance Criteria

1. WHEN tests are written THEN the system SHALL provide mock implementations of all services
2. WHEN repositories are tested THEN the system SHALL allow injecting mock adapters and cache services
3. WHEN WebSocket behavior is tested THEN the system SHALL provide a `MockWebSocketService`
4. WHEN state management is tested THEN the system SHALL allow creating isolated state manager instances
5. WHEN integration tests are written THEN the system SHALL provide test utilities for setting up the full stack

### Requirement 20: Performance Optimization

**User Story:** As a user, I want the application to load quickly and respond smoothly, so that I can work efficiently without delays.

#### Acceptance Criteria

1. WHEN cold data is accessed multiple times THEN the system SHALL serve it from cache without additional HTTP requests
2. WHEN components re-render THEN the system SHALL only re-render when relevant state changes
3. WHEN large datasets are cached THEN the system SHALL implement LRU eviction to manage memory
4. WHEN WebSocket messages arrive in bursts THEN the system SHALL batch cache updates to reduce re-renders
5. WHEN the application bundle is built THEN the system SHALL tree-shake unused code from packages

### Requirement 21: Type Consolidation and Reusability

**User Story:** As a developer, I want all type definitions centralized in one package, so that I can reuse types consistently across the entire codebase.

#### Acceptance Criteria

1. WHEN entity types exist in `@packages/utils` THEN the system SHALL migrate them to `@packages/types/entities`
2. WHEN database types exist in `@packages/utils` THEN the system SHALL migrate them to `@packages/types/entities`
3. WHEN schema types exist in `@packages/utils` THEN the system SHALL migrate them to `@packages/types/entities`
4. WHEN types are migrated THEN the system SHALL update all imports across the codebase to use `@packages/types`
5. WHEN type migration is complete THEN the system SHALL remove duplicate type definitions from `@packages/utils`

### Requirement 22: Fake Implementations for Testing

**User Story:** As a developer, I want to test the application with real repository implementations using fake data, so that I can verify behavior without hitting the backend.

#### Acceptance Criteria

1. WHEN tests are written THEN the system SHALL provide a FakePersistenceProvider that uses real repositories
2. WHEN a FakePersistenceProvider is created THEN the system SHALL use a FakeDatabase for storage
3. WHEN a FakeDatabase is seeded THEN the system SHALL provide standard test data for assertions
4. WHEN repositories are tested THEN the system SHALL support querying, filtering, and updating fake data
5. WHEN tests complete THEN the system SHALL allow clearing the fake database for test isolation

### Requirement 23: Migration Path and Coexistence

**User Story:** As a developer, I want to migrate existing code incrementally, so that I can refactor without breaking the entire application.

#### Acceptance Criteria

1. WHEN new packages are created THEN the system SHALL allow existing code to continue using old patterns
2. WHEN a page is migrated THEN the system SHALL use the new architecture without affecting other pages
3. WHEN both old and new patterns coexist THEN the system SHALL not have conflicts or duplicate state
4. WHEN a migration is complete for a domain THEN the system SHALL remove old code for that domain
5. WHEN all migrations are complete THEN the system SHALL remove all legacy data access code
