/**
 * Test Utilities Module
 *
 * Provides fake implementations for testing repositories and services
 * without hitting the backend.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 18.1, 18.2, 18.3, 18.4, 18.5
 */

// Fake Database Adapter
export {
  FakeDatabaseAdapter,
  type FakeDatabaseAdapterConfig,
  type FakeDatabaseSeedData
} from "./fake-database-adapter";

// Fake WebSocket Service
export {
  FakeWebSocketService,
  type FakeWebSocketServiceConfig
} from "./fake-websocket-service";

// Fake Persistence Provider
export {
  FakePersistenceServiceProvider,
  type FakePersistenceServiceProviderConfig,
  createTestProvider
} from "./fake-persistence-provider";
