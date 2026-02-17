# Implementation Plan

## Phase 1: Foundation and Type Consolidation (Week 1-2)

- [ ] 1.1 Audit existing types in @packages/utils
  - Identify all entity types currently in use
  - Identify all database types
  - Identify all schema types
  - Document findings in audit report
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 1.2 Create @packages/types package structure
  - Create package.json with TypeScript configuration
  - Setup tsconfig.json with strict mode
  - Create directory structure (entities, contracts, services, metadata, errors)
  - Setup build configuration
  - _Requirements: 1.1, 1.4_

- [ ] 1.3 Migrate entity types to @packages/types
  - Move Client, Project, ExtractionJob, ExtractionResult types
  - Move Supplier and Schema types
  - Ensure all types are properly exported
  - Add JSDoc comments for clarity
  - _Requirements: 21.1, 21.2, 21.3_

- [ ] 1.4 Create base repository contracts
  - Define IBaseRepository interface with CRUD operations
  - Create domain-specific repository interfaces (IClientRepository, IProjectRepository, etc.)
  - Export all contracts from index.ts
  - Add comprehensive JSDoc documentation
  - _Requirements: 3.1, 3.2_

- [ ] 1.5 Create data temperature metadata
  - Define DataTemperature type (hot | cold)
  - Create REPOSITORY_METADATA with all domains
  - Define RepositoryMetadata interface
  - Export from index.ts
  - _Requirements: 4.1_

- [ ] 1.6 Create service interfaces
  - Define ICacheService interface
  - Define IWebSocketService interface
  - Define IDatabaseAdapter interface
  - Define error types (NetworkError, ValidationError, etc.)
  - Export all from index.ts
  - _Requirements: 8.1, 9.1, 10.1_

- [ ] 1.7 Create root index.ts for @packages/types
  - Export all entities
  - Export all contracts
  - Export all service interfaces
  - Export metadata and error types
  - Verify no circular dependencies
  - _Requirements: 1.3, 1.5_

- [ ] 1.8 Update imports across codebase
  - Replace @packages/utils type imports with @packages/types
  - Update all files importing entity types
  - Verify all builds pass
  - Run type checking
  - _Requirements: 21.4_

- [ ]\* 1.9 Write unit tests for type definitions
  - Test that types compile correctly
  - Test that interfaces are properly exported
  - Test metadata structure
  - **Property 10: Package Export Completeness**
  - **Validates: Requirements 1.3, 1.5**

## Phase 2: Core Services and Fake Implementations (Week 2-3)

- [ ] 2.1 Create @packages/core-client package structure
  - Create package.json with dependencies (Immer, TanStack Query types)
  - Setup tsconfig.json
  - Create directory structure
  - Setup build configuration
  - _Requirements: 1.2, 1.4_

- [ ] 2.2 Implement cache services
  - Create ICacheService implementation for TanStack Query
  - Create MemoryCacheService for testing
  - Implement TTL-based expiration
  - Implement pattern-based invalidation
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ]\* 2.3 Write unit tests for cache services
  - Test cache get/set operations
  - Test TTL expiration
  - Test pattern-based invalidation
  - Test LRU eviction
  - **Property 9: Cache TTL Enforcement**
  - **Validates: Requirements 4.4, 4.5**

- [ ] 2.4 Implement WebSocket service
  - Create BrowserWebSocketService implementation
  - Create MockWebSocketService for testing
  - Implement connection management
  - Implement subscription/unsubscription
  - Implement exponential backoff reconnection
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ]\* 2.5 Write unit tests for WebSocket service
  - Test connection establishment
  - Test subscription handling
  - Test message routing
  - Test reconnection logic
  - Test error handling

- [ ] 2.6 Implement HTTP adapter
  - Create HttpAdapter with GET, POST, PUT, DELETE methods
  - Implement configurable timeout
  - Implement error handling
  - Implement query parameter encoding
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ]\* 2.7 Write unit tests for HTTP adapter
  - Test HTTP methods
  - Test timeout handling
  - Test error transformation
  - Test parameter encoding

- [ ] 2.8 Create root index.ts for @packages/core-client
  - Export all service implementations
  - Export all repository classes
  - Export state manager and hooks
  - Export providers
  - Verify no circular dependencies
  - _Requirements: 1.3, 1.5_

- [ ] 2.9 Implement FakeDatabase for testing
  - Create in-memory data storage
  - Implement CRUD operations
  - Implement querying and filtering
  - Implement listener subscriptions
  - Implement data seeding methods
  - _Requirements: 22.1, 22.2, 22.3, 22.4_

- [ ] 2.10 Implement FakeCacheService
  - Create in-memory cache storage
  - Implement get/set with TTL
  - Implement pattern-based invalidation
  - Track cache hits and misses
  - _Requirements: 22.1_

- [ ] 2.11 Implement FakeWebSocketService
  - Create mock WebSocket implementation
  - Implement connection simulation
  - Implement subscription tracking
  - Allow manual event triggering for tests
  - _Requirements: 22.1_

- [ ] 2.12 Create StandardTestData seeder
  - Create test client factory
  - Create test project factory
  - Create test extraction job factory
  - Create test extraction result factory
  - Seed FakeDatabase with standard data
  - _Requirements: 22.3, 22.5_

- [ ] 2.13 Create FakePersistenceProvider factory
  - Wire real repositories with fake services
  - Return provider + db + testData
  - Support custom configuration
  - Export from @packages/core-client
  - _Requirements: 22.1, 22.2, 22.3_

- [ ]\* 2.14 Write tests for fake implementations
  - Test FakeDatabase CRUD operations
  - Test FakeCacheService behavior
  - Test FakeWebSocketService subscriptions
  - Test FakePersistenceProvider setup

## Phase 3: Repository Implementation (Week 3-4)

- [ ] 3.1 Implement base cold repository
  - Create BaseColdRepository class
  - Implement cache-first pattern
  - Implement cache invalidation on updates
  - Add error handling
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ]\* 3.2 Write unit tests for cold repository
  - Test cache-first behavior
  - Test HTTP fallback
  - Test cache invalidation
  - **Property 1: Cache Consistency for Cold Data**
  - **Validates: Requirements 5.1, 5.2, 5.3**

- [ ] 3.3 Implement base hot repository
  - Create BaseHotRepository extending BaseColdRepository
  - Implement WebSocket subscription
  - Implement cache update on WebSocket events
  - Add short TTL for hot data
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ]\* 3.4 Write unit tests for hot repository
  - Test WebSocket subscription
  - Test cache updates from WebSocket
  - Test HTTP initial fetch
  - **Property 2: WebSocket Updates Invalidate Cache**
  - **Validates: Requirements 6.2, 6.3**

- [ ] 3.5 Implement domain-specific repositories
  - Create ClientRepository (cold)
  - Create ProjectRepository (cold)
  - Create SupplierRepository (cold)
  - Create ExtractionJobRepository (hot)
  - Create ExtractionResultRepository (hot)
  - _Requirements: 5.1, 6.1_

- [ ]\* 3.6 Write unit tests for domain repositories
  - Test each repository's specific methods
  - Test domain-specific filtering
  - Test error handling

- [ ] 3.7 Implement PersistenceServiceProvider
  - Create singleton provider
  - Implement lazy repository instantiation
  - Implement service injection based on temperature
  - Add configuration method
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ]\* 3.8 Write unit tests for PersistenceServiceProvider
  - Test singleton behavior
  - Test lazy instantiation
  - Test service injection
  - **Property 3: Repository Temperature Determines Wiring**
  - **Validates: Requirements 4.2, 4.3**

## Phase 4: State Management Implementation (Week 4-5)

- [ ] 4.1 Implement state manager with Immer
  - Create StateManager class
  - Implement action dispatch
  - Implement reducer registration
  - Implement listener subscriptions
  - Implement Redux DevTools integration
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [ ]\* 4.2 Write unit tests for state manager
  - Test state immutability
  - Test action dispatch
  - Test reducer routing
  - Test listener notifications
  - **Property 5: Immutable State Updates**
  - **Validates: Requirements 12.1**
  - **Property 6: Action Type Routing**
  - **Validates: Requirements 12.2, 13.5**

- [ ] 4.3 Create UI state slice
  - Define UI state shape
  - Create action creators
  - Create reducers
  - Create selectors
  - _Requirements: 13.1, 13.4, 13.5_

- [ ] 4.4 Create drafts state slice
  - Define drafts state shape
  - Create action creators for project and extraction drafts
  - Create reducers
  - Create selectors
  - _Requirements: 13.2, 13.4, 13.5_

- [ ] 4.5 Create preferences state slice
  - Define preferences state shape
  - Create action creators
  - Create reducers
  - Create selectors
  - _Requirements: 13.3, 13.4, 13.5_

- [ ]\* 4.6 Write unit tests for state slices
  - Test each slice's reducers
  - Test action creators
  - Test selectors

- [ ] 4.7 Implement React hooks
  - Create useAppState hook with useSyncExternalStore
  - Create useDispatch hook
  - Create useUIState convenience hook
  - Create useDrafts convenience hook
  - Create useLoading convenience hook
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ]\* 4.8 Write unit tests for React hooks
  - Test useAppState selector behavior
  - Test re-render optimization
  - Test dispatch function
  - **Property 7: Selector Memoization**
  - **Validates: Requirements 14.1, 14.5**
  - **Property 8: Draft Persistence**
  - **Validates: Requirements 12.5, 17.5**

## Phase 5: Frontend Integration (Week 5-6)

- [ ] 5.1 Setup core-client in frontend
  - Install @packages/core-client and @packages/types
  - Create initialization file
  - Configure TanStack Query client
  - Initialize WebSocket connection
  - Initialize state manager
  - _Requirements: 7.1, 7.4_

- [ ] 5.2 Create app-level providers
  - Create QueryClientProvider wrapper
  - Create StateManagerProvider wrapper
  - Setup error boundaries
  - Setup monitoring/logging
  - _Requirements: 18.1, 18.4_

- [ ] 5.3 Migrate first page to new architecture
  - Choose a simple page (e.g., Clients list)
  - Replace old data access with persistence layer
  - Replace old state with app state hooks
  - Verify functionality
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

- [ ]\* 5.4 Write integration tests for first page
  - Test data fetching
  - Test state management
  - Test user interactions
  - Test error handling

- [ ] 5.5 Migrate second page (hot data)
  - Choose a page with realtime data (e.g., Extraction Jobs)
  - Replace old data access with hot repositories
  - Verify WebSocket updates work
  - Verify cache updates trigger re-renders
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

- [ ]\* 5.6 Write integration tests for hot data page
  - Test initial HTTP fetch
  - Test WebSocket updates
  - Test cache invalidation
  - Test component re-renders

- [ ] 5.7 Migrate form with drafts
  - Choose a form page
  - Implement draft storage in app state
  - Implement optimistic updates
  - Test save/cancel flows
  - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

- [ ]\* 5.8 Write integration tests for drafts
  - Test draft creation and updates
  - Test save success flow
  - Test save failure flow
  - Test draft persistence

## Phase 6: Error Handling and Testing (Week 6-7)

- [ ] 6.1 Implement error handling layer
  - Create typed error classes
  - Implement retry logic with exponential backoff
  - Implement error transformation
  - Implement error logging
  - _Requirements: 18.1, 18.2, 18.3, 18.4_

- [ ] 6.2 Create error boundaries
  - Create React error boundary component
  - Implement error recovery
  - Implement error logging
  - _Requirements: 18.5_

- [ ]\* 6.3 Write comprehensive error handling tests
  - Test network error retry
  - Test validation error transformation
  - Test error logging
  - Test error boundary recovery

- [ ] 6.4 Create test utilities
  - Export FakePersistenceProvider factory
  - Create test state manager setup helper
  - Create test query client setup helper
  - Create WebSocket event simulator helper
  - Create test data builder utilities
  - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 22.1, 22.2, 22.3_

- [ ]\* 6.5 Write property-based tests
  - **Property 1: Cache Consistency for Cold Data**
  - **Property 2: WebSocket Updates Invalidate Cache**
  - **Property 3: Repository Temperature Determines Wiring**
  - **Property 4: State Separation - No Server Data in App State**
  - **Property 5: Immutable State Updates**
  - **Property 6: Action Type Routing**
  - **Property 7: Selector Memoization**
  - **Property 8: Draft Persistence**
  - **Property 9: Cache TTL Enforcement**
  - **Property 10: Package Export Completeness**

- [ ] 6.6 Checkpoint - Ensure all tests pass
  - Run all unit tests
  - Run all integration tests
  - Run all property-based tests
  - Check test coverage (target >80%)
  - Ask the user if questions arise

## Phase 7: Performance and Migration (Week 7-8)

- [ ] 7.1 Optimize bundle size
  - Enable tree-shaking in build
  - Verify unused code is removed
  - Measure bundle size impact
  - Document optimization results
  - _Requirements: 20.5_

- [ ] 7.2 Implement performance monitoring
  - Add cache hit rate tracking
  - Add API response time tracking
  - Add WebSocket message rate tracking
  - Add component re-render tracking
  - _Requirements: 20.1, 20.2, 20.4_

- [ ] 7.3 Migrate remaining pages
  - Migrate all cold data pages
  - Migrate all hot data pages
  - Migrate all form pages
  - Verify all functionality
  - _Requirements: 22.1, 22.2, 22.3_

- [ ] 7.4 Remove legacy data access code
  - Remove old API call utilities
  - Remove old state management code
  - Remove old data access patterns
  - Update documentation
  - _Requirements: 22.4, 22.5_

- [ ] 7.5 Final testing and validation
  - Run full test suite
  - Perform manual testing
  - Verify performance metrics
  - Verify no regressions
  - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

- [ ] 7.6 Checkpoint - Ensure all tests pass
  - Run all unit tests
  - Run all integration tests
  - Run all property-based tests
  - Verify test coverage
  - Ask the user if questions arise

- [ ] 7.7 Documentation and knowledge transfer
  - Document architecture decisions
  - Create developer guide
  - Create migration guide
  - Create troubleshooting guide
  - _Requirements: 2.5_
