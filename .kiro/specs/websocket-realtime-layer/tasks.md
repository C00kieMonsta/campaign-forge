# Implementation Plan

- [x] 1. Set up database triggers and notification function
  - Create the reusable `notify_row_change()` Postgres function that builds JSON payloads and calls pg_notify()
  - Create triggers on `extraction_jobs` table for INSERT, UPDATE, and DELETE operations
  - Create triggers on `projects` table for INSERT, UPDATE, and DELETE operations
  - Create triggers on `extraction_results` table for INSERT, UPDATE, and DELETE operations
  - Create triggers on `data_layers` table for INSERT, UPDATE, and DELETE operations
  - Create triggers on `supplier_matches` table for INSERT, UPDATE, and DELETE operations
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 2. Install backend dependencies and create realtime module structure
  - Install `ws`, `@nestjs/websockets`, `@nestjs/platform-ws`, and `pg` packages in backend
  - Create `apps/backend/src/realtime` directory
  - Create `realtime.module.ts` with module definition
  - _Requirements: 3.1, 6.1_

- [x] 3. Implement PgListenerService
  - Create `pg-listener.service.ts` with connection management to Postgres using DATABASE_URL_DIRECT
  - Implement `onModuleInit` to establish connection and execute LISTEN commands for channels from PG_CHANNELS env var
  - Implement notification handler that forwards events to registered callback
  - Implement automatic reconnection logic with 1-second delay on connection failure
  - Implement `onModuleDestroy` for graceful cleanup
  - _Requirements: 3.1, 3.2, 3.3, 5.1, 6.1, 6.2_

- [x] 4. Implement RealtimeGateway
  - Create `realtime.gateway.ts` with @WebSocketGateway decorator configured for /ws path
  - Implement connection handler that initializes empty subscription set for each client
  - Implement message handler to process subscribe/unsubscribe messages from clients
  - Implement disconnect handler to clean up client subscriptions
  - Implement broadcast method that filters notifications by client subscriptions
  - Integrate PgListenerService by setting handler to call broadcast method
  - _Requirements: 3.3, 3.4, 3.5, 5.5_

- [x] 5. Integrate RealtimeModule into AppModule
  - Import RealtimeModule in `apps/backend/src/app.module.ts`
  - Add DATABASE_URL_DIRECT and PG_CHANNELS to backend .env file
  - Add FRONTEND_URL to backend .env for CORS configuration
  - _Requirements: 6.1, 6.5_

- [x] 6. Create frontend WebSocket subscription hook
  - Create `apps/frontend/src/hooks/use-realtime-subscription.ts` with generic subscription logic
  - Implement WebSocket connection management with connection to NEXT_PUBLIC_WS_URL
  - Implement subscribe message sending on connection open
  - Implement message handler that parses notifications and updates TanStack Query cache using setQueryData
  - Implement default handlers for INSERT (add to array), UPDATE (merge), and DELETE (remove) operations
  - Support custom handlers via options for complex update logic
  - Implement automatic reconnection with exponential backoff (max 30 seconds)
  - Implement cleanup on unmount with unsubscribe and connection close
  - _Requirements: 1.2, 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 5.3, 5.4_

- [x] 7. Create table-specific live hooks for projects
  - Create `apps/frontend/src/hooks/use-projects-live.ts` that uses useRealtimeSubscription
  - Configure channel as 'projects' and query key using existing qk.projects.list pattern
  - Implement custom onInsert handler to maintain sort order by createdAt
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3_

- [x] 8. Create table-specific live hooks for extraction jobs
  - Create `apps/frontend/src/hooks/use-extraction-jobs-live.ts` that uses useRealtimeSubscription
  - Configure channel as 'extraction_jobs' and query key using existing qk.extraction.jobs pattern
  - Use default handlers for INSERT/UPDATE/DELETE operations
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.1, 8.2, 8.3_

- [x] 9. Integrate real-time updates into projects list component
  - Add useProjectsLive hook to projects list component
  - Verify existing useProjects hook continues to work for initial data fetch
  - Test that new projects appear automatically without refresh
  - Test that project updates reflect immediately
  - Test that deleted projects disappear automatically
  - _Requirements: 7.1, 7.2, 7.3, 7.5, 8.4_

- [x] 10. Integrate real-time updates into extraction jobs components
  - Add useExtractionJobsLive hook to extraction job list/table components
  - Verify existing extraction job queries continue to work for initial data fetch
  - Test that job status updates appear automatically (e.g., queued → processing → completed)
  - Test that progress percentage updates reflect in real-time
  - _Requirements: 1.1, 1.2, 1.5, 8.4, 8.5_

- [x] 11. Add environment variables and configuration
  - Add NEXT_PUBLIC_WS_URL to frontend .env.local file
  - Document environment variable requirements in README or deployment docs
  - Verify DATABASE_URL_DIRECT uses port 5432 (direct Postgres, not PgBouncer)
  - _Requirements: 6.1, 6.5_

- [x] 12. Add error handling and logging
  - Add console logging for connection events in PgListenerService
  - Add console logging for WebSocket connection/disconnection in RealtimeGateway
  - Add error logging for malformed messages in both backend and frontend
  - Verify graceful degradation when WebSocket is unavailable
  - _Requirements: 5.1, 5.2, 5.4_

- [ ]\* 13. Write backend unit tests
  - Write tests for PgListenerService connection and reconnection logic
  - Write tests for RealtimeGateway subscription management
  - Write tests for broadcast filtering by channel subscriptions
  - Mock pg.Client and WebSocket connections
  - _Requirements: 3.4, 3.5, 5.5_

- [ ]\* 14. Write frontend unit tests
  - Write tests for useRealtimeSubscription hook with INSERT/UPDATE/DELETE operations
  - Write tests for reconnection logic with exponential backoff
  - Write tests for subscription lifecycle (mount/unmount)
  - Mock WebSocket API
  - _Requirements: 4.4, 4.5, 5.2, 5.3_

- [ ]\* 15. Perform integration testing
  - Test end-to-end flow: database insert → notification → WebSocket → cache update
  - Test multi-client broadcasting with multiple browser tabs
  - Test reconnection scenarios by simulating network disconnection
  - Verify no duplicate entries appear in UI
  - Test with high-frequency updates to verify performance
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.3, 3.4, 5.3_
