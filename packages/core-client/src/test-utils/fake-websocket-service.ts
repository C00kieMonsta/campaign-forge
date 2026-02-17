/**
 * Fake WebSocket Service for Testing
 *
 * Provides an in-memory implementation of IWebSocketService for testing
 * hot repositories without a real WebSocket connection.
 *
 * Requirements: 17.2, 17.5
 */

import type {
  IWebSocketService,
  WebSocketHandler,
  WebSocketPayload
} from "@packages/types";

/**
 * Configuration for FakeWebSocketService
 */
export interface FakeWebSocketServiceConfig {
  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;

  /**
   * Start in connected state
   * @default true
   */
  startConnected?: boolean;
}

/**
 * FakeWebSocketService Implementation
 *
 * Provides a fake WebSocket service for testing that:
 * - Tracks subscriptions to channels
 * - Allows manual triggering of events
 * - Simulates connection state
 * - Supports testing reconnection scenarios
 *
 * Requirement 17.2: WHEN tests are written THEN the system SHALL provide
 * a FakeWebSocketService with manual event triggering
 */
export class FakeWebSocketService implements IWebSocketService {
  private handlers: Map<string, Set<WebSocketHandler>> = new Map();
  private connected: boolean;
  private readonly debug: boolean;
  private eventHistory: Array<{ channel: string; payload: WebSocketPayload }> =
    [];
  private subscriptionHistory: Array<{
    action: "subscribe" | "unsubscribe";
    channel: string;
  }> = [];

  constructor(config: FakeWebSocketServiceConfig = {}) {
    this.debug = config.debug ?? false;
    this.connected = config.startConnected ?? true;
  }

  /**
   * Simulate connecting to WebSocket server
   */
  async connect(_url: string): Promise<void> {
    this.log(`Connecting to ${_url}`);
    this.connected = true;
  }

  /**
   * Simulate disconnecting from WebSocket server
   */
  async disconnect(): Promise<void> {
    this.log("Disconnecting");
    this.connected = false;
    this.handlers.clear();
  }

  /**
   * Subscribe to a channel with a handler
   */
  subscribe(channel: string, handler: WebSocketHandler): void {
    this.log(`Subscribing to channel: ${channel}`);

    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }

    this.handlers.get(channel)!.add(handler);
    this.subscriptionHistory.push({ action: "subscribe", channel });
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel: string, handler: WebSocketHandler): void {
    this.log(`Unsubscribing from channel: ${channel}`);

    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      channelHandlers.delete(handler);

      if (channelHandlers.size === 0) {
        this.handlers.delete(channel);
      }
    }

    this.subscriptionHistory.push({ action: "unsubscribe", channel });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================================
  // Test Helper Methods
  // ============================================================================

  /**
   * Manually emit an event to all handlers subscribed to a channel
   *
   * This is the primary method for testing WebSocket integration.
   * Call this to simulate receiving a message from the server.
   *
   * @param channel - The channel to emit to (e.g., 'extraction_jobs')
   * @param payload - The WebSocket payload to emit
   *
   * @example
   * ```typescript
   * fakeWs.emit('extraction_jobs', {
   *   op: 'UPDATE',
   *   table: 'extraction_jobs',
   *   new: { id: '123', status: 'completed' }
   * });
   * ```
   */
  emit(channel: string, payload: WebSocketPayload): void {
    this.log(`Emitting to channel ${channel}:`, payload);
    this.eventHistory.push({ channel, payload });

    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      channelHandlers.forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Error in handler for channel ${channel}:`, error);
        }
      });
    }
  }

  /**
   * Emit an INSERT event
   *
   * @param channel - The channel to emit to
   * @param entity - The new entity data
   */
  emitInsert(channel: string, entity: Record<string, any>): void {
    this.emit(channel, {
      op: "INSERT",
      table: channel,
      new: entity
    });
  }

  /**
   * Emit an UPDATE event
   *
   * @param channel - The channel to emit to
   * @param entity - The updated entity data
   */
  emitUpdate(channel: string, entity: Record<string, any>): void {
    this.emit(channel, {
      op: "UPDATE",
      table: channel,
      new: entity
    });
  }

  /**
   * Emit a DELETE event
   *
   * @param channel - The channel to emit to
   * @param entity - The deleted entity data
   */
  emitDelete(channel: string, entity: Record<string, any>): void {
    this.emit(channel, {
      op: "DELETE",
      table: channel,
      old: entity
    });
  }

  /**
   * Simulate connection loss
   */
  simulateDisconnect(): void {
    this.log("Simulating disconnect");
    this.connected = false;
  }

  /**
   * Simulate reconnection
   */
  simulateReconnect(): void {
    this.log("Simulating reconnect");
    this.connected = true;
  }

  /**
   * Check if a channel has any subscribers
   */
  hasSubscribers(channel: string): boolean {
    const handlers = this.handlers.get(channel);
    return handlers !== undefined && handlers.size > 0;
  }

  /**
   * Get the number of subscribers for a channel
   */
  getSubscriberCount(channel: string): number {
    return this.handlers.get(channel)?.size ?? 0;
  }

  /**
   * Get all subscribed channels
   */
  getSubscribedChannels(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get the event history for testing assertions
   */
  getEventHistory(): Array<{ channel: string; payload: WebSocketPayload }> {
    return [...this.eventHistory];
  }

  /**
   * Get the subscription history for testing assertions
   */
  getSubscriptionHistory(): Array<{
    action: "subscribe" | "unsubscribe";
    channel: string;
  }> {
    return [...this.subscriptionHistory];
  }

  /**
   * Clear event history
   */
  clearEventHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Clear subscription history
   */
  clearSubscriptionHistory(): void {
    this.subscriptionHistory = [];
  }

  /**
   * Reset the fake service to initial state
   */
  reset(): void {
    this.log("Resetting fake WebSocket service");
    this.handlers.clear();
    this.eventHistory = [];
    this.subscriptionHistory = [];
    this.connected = true;
  }

  /**
   * Log debug messages
   */
  private log(message: string, ...args: any[]): void {
    if (this.debug) {
      console.log(`[FakeWebSocketService] ${message}`, ...args);
    }
  }
}
