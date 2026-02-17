/**
 * Services module exports
 * 
 * This module provides service implementations for data access and communication.
 */

export {
  HttpDatabaseAdapter,
  type HttpDatabaseAdapterConfig,
} from './database-adapter';

export {
  RealtimeWebSocketService,
  type RealtimeWebSocketServiceConfig,
} from './websocket-service';
