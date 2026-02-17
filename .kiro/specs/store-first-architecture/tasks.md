# Implementation Plan

## Phase 1: Foundation - Type Definitions and Store Setup

- [x] 1. Define store state types in @packages/types
  - Create `src/store/app-state.ts` with AppState, EntitiesState, UIState, DraftsState, PreferencesState interfaces
  - Add normalized entity relationship types (entity IDs instead of nested objects)
  - Export all store types from `src/store/index.ts`
  - _Requirements: 1.1, 1.2, 8.1, 8.2, 8.3, 8.4, 8.5, 15.1, 15.2_

- [x] 2. Set up Redux store in @packages/core-client
  - Create package.json with dependencies (@reduxjs/toolkit, immer, react-redux)
  - Configure Redux store with Redux Toolkit in `src/store/store.ts`
  - Create entities slice with normalized storage structure in `src/store/slices/entities-slice.ts`
  - Create ui slice for selections, filters, and loading states in `src/store/slices/ui-slice.ts`
  - Create drafts slice for unsaved form data in `src/store/slices/drafts-slice.ts`
  - Create preferences slice for user settings in `src/store/slices/preferences-slice.ts`
  - Export store configuration and types from `src/store/index.ts`
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 8.1, 8.2, 8.3, 8.4, 8.5, 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 3. Create selector functions for store access
  - Implement entity selectors (selectClientById, selectProjectById, etc.) in `src/store/selectors/entity-selectors.ts`
  - Implement collection selectors with filtering in `src/store/selectors/collection-selectors.ts`
  - Implement relationship selectors (selectProjectsForClient, etc.) in `src/store/selectors/relationship-selectors.ts`
  - Implement UI state selectors in `src/store/selectors/ui-selectors.ts`
  - Export all selectors from `src/store/selectors/index.ts`
  - _Requirements: 2.4, 2.5, 15.4_

## Phase 2: Service Layer - Adapters and WebSocket

- [x] 4. Implement DatabaseAdapter for HTTP communication
  - Create DatabaseAdapter interface in `src/services/database-adapter.ts`
  - Implement HttpDatabaseAdapter with fetch-based HTTP methods (get, post, put, patch, delete)
  - Add authentication token injection from Supabase
  - Add error handling and retry logic with exponential backoff
  - Export adapter types and implementations from `src/services/index.ts`
  - _Requirements: 3.1, 3.4, 20.1, 20.2, 20.3, 20.4_

- [x] 5. Implement WebSocket service for realtime updates
  - Create WebSocketService interface in `src/services/websocket-service.ts`
  - Implement RealtimeWebSocketService with connection management
  - Add channel subscription and message routing
  - Implement reconnection logic with exponential backoff
  - Add connection state tracking (isConnected)
  - Export WebSocket types and implementations from `src/services/index.ts`
  - _Requirements: 11.1, 11.2, 11.3, 11.5, 20.2_

## Phase 3: Repository Pattern - Cold Data Repositories

**Note: All repositories follow a unified pattern that implements BOTH the generic store-first interface (IColdRepository/IHotRepository) AND the domain-specific interface (e.g., IClientRepository). This provides a single, clean implementation without parallel patterns. See `packages/core-client/REPOSITORY_PATTERN.md` for details.**

- [x] 6. Create base repository abstractions
  - Define Repository<T> interface in `src/repositories/base-repository.ts`
  - Define ColdRepository<T> and HotRepository<T> interfaces
  - Create abstract BaseRepository class with common CRUD operations
  - Implement normalization utilities for entity storage
  - Export repository interfaces from `src/repositories/index.ts`
  - _Requirements: 3.1, 3.2, 3.3, 15.3, 16.2_

- [x] 7. Implement ClientRepository (cold data)
  - Create ClientRepository extending BaseRepository in `src/repositories/client-repository.ts`
  - Implement IColdRepository<Client> interface (generic CRUD with store hydration)
  - Implement IClientRepository interface (domain-specific methods)
  - Add DTO transformation for createClient and updateClient methods
  - Implement getClientsByOrganization and pagination methods
  - Add optional TanStack Query caching with cache invalidation on mutations
  - Note: Follow unified pattern - single implementation for both interfaces (see REPOSITORY_PATTERN.md)
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 8. Implement ProjectRepository (cold data)
  - Create ProjectRepository extending BaseRepository in `src/repositories/project-repository.ts`
  - Implement IColdRepository<Project> interface (generic CRUD with store hydration)
  - Implement IProjectRepository interface (domain-specific methods)
  - Add DTO transformation for createProject and updateProject methods
  - Implement getProjectsByClient, getProjectsByOrganization, and pagination methods
  - Implement archive/restore/permanentlyDelete operations
  - Add optional TanStack Query caching with cache invalidation on mutations
  - Note: Follow unified pattern established in ClientRepository (see REPOSITORY_PATTERN.md)
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5_

## Phase 4: Repository Pattern - Hot Data Repositories

**Note: Hot repositories follow the same unified pattern as cold repositories, but with WebSocket subscriptions and shorter cache TTLs. See `packages/core-client/REPOSITORY_PATTERN.md` for details.**

- [x] 9. Implement ExtractionJobRepository (hot data)
  - Create ExtractionJobRepository extending BaseRepository in `src/repositories/extraction-job-repository.ts`
  - Implement IHotRepository<ExtractionJob> interface (generic CRUD with store hydration)
  - Implement IExtractionJobRepository interface (domain-specific methods)
  - Add DTO transformation for create and update methods
  - Subscribe to WebSocket channel for job updates in constructor
  - Implement WebSocket message handler to update store on job status changes
  - Add unsubscribe logic for cleanup
  - Use short-TTL caching (30 seconds) for hot data
  - Note: Follow unified pattern established in ClientRepository (see REPOSITORY_PATTERN.md)
  - _Requirements: 3.1, 3.2, 3.3, 6.1, 6.2, 6.3, 6.4, 6.5, 11.2, 11.3, 11.4, 13.1, 13.2, 13.3, 13.4_

- [x] 10. Implement ExtractionResultRepository (hot data)
  - Create ExtractionResultRepository extending BaseRepository in `src/repositories/extraction-result-repository.ts`
  - Implement IHotRepository<ExtractionResult> interface (generic CRUD with store hydration)
  - Implement IExtractionResultRepository interface (domain-specific methods)
  - Add DTO transformation for create and update methods
  - Subscribe to WebSocket channel for result updates
  - Implement WebSocket message handler to update store on new results
  - Add unsubscribe logic for cleanup
  - Use short-TTL caching (30 seconds) for hot data
  - Note: Follow unified pattern established in ClientRepository (see REPOSITORY_PATTERN.md)
  - _Requirements: 3.1, 3.2, 3.3, 6.1, 6.2, 6.3, 6.4, 6.5, 11.2, 11.3, 11.4, 13.1, 13.2, 13.3, 13.4_

## Phase 5: Optimistic Updates

- [x] 11. Implement optimistic update pattern in repositories
  - Add updateOptimistic method to BaseRepository
  - Implement read current entity from store
  - Implement immediate optimistic update to store
  - Implement HTTP request with success/failure handling
  - Implement rollback logic on failure with error state in ui slice
  - Add optimistic update support to ClientRepository and ProjectRepository
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 20.5_

## Phase 6: Persistence Service Provider

- [x] 12. Create PersistenceServiceProvider singleton
  - Implement PersistenceServiceProvider class in `src/persistence/persistence-service-provider.ts`
  - Add singleton initialization with store, adapter, wsService, and optional queryClient
  - Create repository getter methods (clients, projects, extractionJobs, extractionResults)
  - Inject appropriate dependencies for cold vs hot repositories
  - Add getPersistenceServiceProvider() convenience function
  - Export from `src/persistence/index.ts`
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 16.2, 16.3_

## Phase 7: React Integration Hooks

- [x] 13. Create React hooks for store access
  - Implement useAppState(selector) hook in `src/hooks/use-app-state.ts`
  - Implement useEntity(type, id) hook in `src/hooks/use-entity.ts`
  - Implement useCollection(type, filter) hook in `src/hooks/use-collection.ts`
  - Implement useUIState() hook in `src/hooks/use-ui-state.ts`
  - Implement useDispatch() hook wrapper in `src/hooks/use-dispatch.ts`
  - Export all hooks from `src/hooks/index.ts`
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 15.4, 21.2, 21.3_

- [x] 14. Create repository access hooks
  - Implement usePersistence() hook to access PersistenceServiceProvider in `src/hooks/use-persistence.ts`
  - Implement useClientRepository() convenience hook in `src/hooks/use-client-repository.ts`
  - Implement useProjectRepository() convenience hook in `src/hooks/use-project-repository.ts`
  - Export repository hooks from `src/hooks/index.ts`
  - _Requirements: 3.4, 9.5, 12.1_

## Phase 8: Testing Infrastructure

- [x] 15. Create fake implementations for testing
  - Implement FakeDatabaseAdapter with in-memory storage in `src/test-utils/fake-database-adapter.ts`
  - Add seed data support to FakeDatabaseAdapter
  - Implement FakeWebSocketService with manual event triggering in `src/test-utils/fake-websocket-service.ts`
  - Create FakePersistenceServiceProvider that wires fakes with real repositories in `src/test-utils/fake-persistence-provider.ts`
  - Export test utilities from `src/test-utils/index.ts`
  - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 18.1, 18.2, 18.3, 18.4, 18.5_

- [ ]* 16. Write unit tests for store slices
  - Write tests for entities slice actions and reducers
  - Write tests for ui slice actions and reducers
  - Write tests for drafts slice actions and reducers
  - Write tests for preferences slice actions and reducers
  - _Requirements: 2.1, 2.2, 8.1, 8.2, 8.3, 8.4_

- [ ]* 17. Write unit tests for selectors
  - Write tests for entity selectors (selectClientById, etc.)
  - Write tests for collection selectors with filtering
  - Write tests for relationship selectors
  - Write tests for UI state selectors
  - _Requirements: 2.4, 2.5_

- [ ]* 18. Write unit tests for repositories
  - Write tests for ClientRepository using FakeDatabaseAdapter
  - Write tests for ProjectRepository using FakeDatabaseAdapter
  - Write tests for ExtractionJobRepository with FakeWebSocketService
  - Write tests for ExtractionResultRepository with FakeWebSocketService
  - Verify store hydration, optimistic updates, and rollback behavior
  - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

## Phase 9: Frontend Integration

- [x] 19. Initialize store and providers in frontend app
  - Add Redux Provider to apps/frontend/src/app/layout.tsx
  - Initialize PersistenceServiceProvider in frontend app startup
  - Configure HttpDatabaseAdapter with Supabase auth token
  - Configure RealtimeWebSocketService with backend WebSocket URL
  - Pass optional QueryClient to PersistenceServiceProvider
  - _Requirements: 1.1, 9.1, 9.2, 12.1, 12.2_

- [x] 20. Migrate ClientContext to store-first architecture
  - Replace ClientContext with store-based implementation
  - Update components using useClient() to use useEntity and useCollection hooks
  - Update client selection logic to use ui slice
  - Migrate localStorage persistence to preferences slice
  - Remove ClientContext.tsx after migration complete
  - _Requirements: 1.3, 10.1, 10.2, 10.3, 12.5, 22.1, 22.2, 22.3_

- [x] 21. Update client-related components to use new architecture
  - Update client list components to use useCollection('clients')
  - Update client detail components to use useEntity('clients', id)
  - Update client forms to use repository methods for create/update
  - Update client selection UI to read from and write to ui slice
  - Verify optimistic updates work correctly
  - _Requirements: 3.4, 3.5, 7.1, 7.2, 7.3, 7.4, 10.1, 10.2, 12.1, 12.4_

- [x] 22. Update project-related components to use new architecture
  - Update project list components to use useCollection('projects')
  - Update project detail components to use useEntity('projects', id)
  - Update project forms to use repository methods for create/update
  - Update project-client relationship rendering to use selectors
  - Verify cache invalidation works correctly
  - _Requirements: 3.4, 3.5, 10.1, 10.2, 10.3, 12.1, 12.4_

## Phase 10: Realtime Integration

- [x] 23. Integrate WebSocket updates for extraction jobs
  - Verify ExtractionJobRepository WebSocket subscription is active
  - Update extraction job list components to read from store
  - Verify realtime updates trigger component re-renders
  - Test WebSocket reconnection on connection loss
  - Verify batch updates minimize re-renders
  - _Requirements: 6.1, 6.2, 6.3, 11.1, 11.2, 11.3, 11.4, 11.5, 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 24. Integrate WebSocket updates for extraction results
  - Verify ExtractionResultRepository WebSocket subscription is active
  - Update extraction result components to read from store
  - Verify realtime updates trigger component re-renders
  - Test multiple rapid updates are batched correctly
  - _Requirements: 6.1, 6.2, 6.3, 11.1, 11.2, 11.3, 11.4, 13.1, 13.2, 13.3, 13.4, 13.5_

## Phase 11: Performance Optimization

- [ ] 25. Optimize selectors with memoization
  - Add reselect library for memoized selectors
  - Convert expensive selectors to use createSelector
  - Verify selector memoization reduces re-renders
  - Add performance monitoring for selector execution
  - _Requirements: 21.1, 21.2, 21.3_

- [ ] 26. Implement batch update optimization
  - Add batch action support to Redux store
  - Implement batching for WebSocket message bursts
  - Verify reduced re-render count with React DevTools
  - _Requirements: 13.5, 21.4_

- [ ] 27. Configure tree-shaking and bundle optimization
  - Verify package exports are tree-shakeable
  - Configure webpack/rollup for optimal bundling
  - Analyze bundle size and remove unused code
  - _Requirements: 21.5_

## Phase 12: Documentation and Cleanup

- [ ] 28. Add package documentation
  - Create README.md for @packages/core-client with usage examples
  - Document store structure and slices
  - Document repository pattern and usage
  - Document testing with fake implementations
  - Add JSDoc comments to all public APIs
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

- [ ] 29. Remove legacy data access patterns
  - Remove remaining Context providers after migration
  - Remove direct TanStack Query usage from components
  - Remove direct API calls from components
  - Clean up unused imports and dependencies
  - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5_

- [ ] 30. Final integration testing and validation
  - Verify all requirements are met
  - Test complete user flows end-to-end
  - Verify no duplicate state exists
  - Verify Redux DevTools integration works
  - Ensure all tests pass, ask the user if questions arise
  - _Requirements: 1.5, 14.4, 14.5, 22.3_
