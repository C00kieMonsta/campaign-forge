/**
 * Service interfaces for core-client implementations
 */

/**
 * Cache service interface for managing cached data
 */
export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  invalidate(key: string): Promise<void>;
  invalidatePattern(pattern: string): Promise<void>;
}

/**
 * WebSocket message payload from PostgreSQL NOTIFY triggers
 *
 * The payload format matches the database trigger function:
 * - INSERT/UPDATE: { op, table, new: {...} }
 * - DELETE: { op, table, old: {...} }
 */
export interface WebSocketPayload {
  op: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  new?: Record<string, any>; // Present for INSERT and UPDATE operations
  old?: Record<string, any>; // Present for DELETE operations
}

/**
 * WebSocket message handler function
 */
export type WebSocketHandler = (payload: WebSocketPayload) => void;

/**
 * WebSocket service interface for realtime updates
 */
export interface IWebSocketService {
  connect(url: string): Promise<void>;
  subscribe(channel: string, handler: WebSocketHandler): void;
  unsubscribe(channel: string, handler: WebSocketHandler): void;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

/**
 * Database adapter interface for HTTP operations
 */
export interface IDatabaseAdapter {
  get<T>(path: string, params?: Record<string, any>): Promise<T>;
  post<T>(path: string, data?: any): Promise<T>;
  put<T>(path: string, data?: any): Promise<T>;
  patch<T>(path: string, data?: any): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

/**
 * Error types for the application
 */
export class NetworkError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: Error
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
