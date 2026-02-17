/**
 * WebSocket service for realtime updates
 *
 * This module provides the implementation of the IWebSocketService interface
 * with support for connection management, channel subscriptions, message routing,
 * and automatic reconnection with exponential backoff.
 */

import {
  IWebSocketService,
  WebSocketHandler,
  WebSocketPayload
} from "@packages/types";

/**
 * Configuration options for RealtimeWebSocketService
 */
export interface RealtimeWebSocketServiceConfig {
  maxReconnectAttempts?: number;
  initialReconnectDelay?: number;
  maxReconnectDelay?: number;
  heartbeatInterval?: number;
  debug?: boolean;
}

/**
 * Connection state for the WebSocket
 */
type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

/**
 * Realtime WebSocket Service implementation
 *
 * Provides WebSocket communication with the backend including:
 * - Connection management with state tracking
 * - Channel subscription and message routing
 * - Automatic reconnection with exponential backoff
 * - Heartbeat mechanism to keep connection alive
 * - Message queuing during reconnection
 */
export class RealtimeWebSocketService implements IWebSocketService {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private connectionState: ConnectionState = "disconnected";
  private handlers: Map<string, Set<WebSocketHandler>> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private messageQueue: Array<{ channel: string; data: any }> = [];

  private readonly maxReconnectAttempts: number;
  private readonly initialReconnectDelay: number;
  private readonly maxReconnectDelay: number;
  private readonly heartbeatInterval: number;
  private readonly debug: boolean;

  constructor(config: RealtimeWebSocketServiceConfig = {}) {
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 5;
    this.initialReconnectDelay = config.initialReconnectDelay ?? 1000;
    this.maxReconnectDelay = config.maxReconnectDelay ?? 30000;
    this.heartbeatInterval = config.heartbeatInterval ?? 30000;
    this.debug = config.debug ?? false;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(url: string): Promise<void> {
    if (
      this.connectionState === "connected" ||
      this.connectionState === "connecting"
    ) {
      return;
    }

    this.url = url;
    this.connectionState = "connecting";

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.connectionState = "connected";
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.flushMessageQueue();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.ws.onerror = (error) => {
          if (this.connectionState === "connecting") {
            reject(new Error("Failed to connect to WebSocket"));
          }
        };

        this.ws.onclose = (_event) => {
          this.handleDisconnection();
        };
      } catch (error) {
        this.connectionState = "disconnected";
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  async disconnect(): Promise<void> {
    // Clear timers
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close connection
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.connectionState = "disconnected";
    this.reconnectAttempts = 0;
    this.messageQueue = [];
  }

  /**
   * Subscribe to a channel with a handler
   */
  subscribe(channel: string, handler: WebSocketHandler): void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }

    this.handlers.get(channel)!.add(handler);

    // Send subscription message if connected
    if (this.isConnected()) {
      this.sendSubscription(channel);
    }
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel: string, handler: WebSocketHandler): void {
    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      channelHandlers.delete(handler);

      // Remove channel if no more handlers
      if (channelHandlers.size === 0) {
        this.handlers.delete(channel);

        // Send unsubscription message if connected
        if (this.isConnected()) {
          this.sendUnsubscription(channel);
        }
      }
    }
  }

  /**
   * Check if the WebSocket is connected
   */
  isConnected(): boolean {
    return (
      this.connectionState === "connected" &&
      this.ws?.readyState === WebSocket.OPEN
    );
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const payload: WebSocketPayload = JSON.parse(event.data);

      // Route message to subscribed handlers based on table name
      // The PostgreSQL trigger sends the table name in the 'table' field
      const channelHandlers = this.handlers.get(payload.table);
      if (channelHandlers) {
        channelHandlers.forEach((handler) => {
          try {
            handler(payload);
          } catch (error) {
            // Intentionally keep this error log since it helps identify misbehaving user handlers
            console.error(
              `Error in WebSocket handler for channel ${payload.table}:`,
              error
            );
          }
        });
      }
    } catch (error) {
      // Intentionally keep this error log since it helps identify protocol issues
      console.error("Failed to parse WebSocket message:", error);
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  private handleDisconnection(): void {
    this.stopHeartbeat();
    this.connectionState = "disconnected";

    // Attempt reconnection if we have a URL and haven't exceeded max attempts
    if (this.url && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.attemptReconnection();
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // This error makes sense to keep: indicates manual intervention needed
      console.error(
        "Max reconnection attempts reached. Please reconnect manually."
      );
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnection(): void {
    if (this.connectionState === "reconnecting") {
      return;
    }

    this.connectionState = "reconnecting";
    this.reconnectAttempts++;

    const delay = this.calculateReconnectDelay(this.reconnectAttempts - 1);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(this.url!);
        // Resubscribe to all channels
        this.resubscribeAll();
      } catch (_error) {
        this.handleDisconnection();
      }
    }, delay);
  }

  /**
   * Calculate reconnection delay using exponential backoff
   */
  private calculateReconnectDelay(attempt: number): number {
    const exponentialDelay = this.initialReconnectDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // Add 10% jitter
    return Math.min(exponentialDelay + jitter, this.maxReconnectDelay);
  }

  /**
   * Resubscribe to all channels after reconnection
   */
  private resubscribeAll(): void {
    this.handlers.forEach((_, channel) => {
      this.sendSubscription(channel);
    });
  }

  /**
   * Send subscription message to server
   */
  private sendSubscription(channel: string): void {
    this.sendMessage({
      type: "subscribe",
      channel
    });
  }

  /**
   * Send unsubscription message to server
   */
  private sendUnsubscription(channel: string): void {
    this.sendMessage({
      type: "unsubscribe",
      channel
    });
  }

  /**
   * Send a message through the WebSocket
   */
  private sendMessage(data: any): void {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify(data));
    } else {
      // Queue message for later if not connected
      this.messageQueue.push(data);
    }
  }

  /**
   * Flush queued messages after reconnection
   */
  private flushMessageQueue(): void {
    if (this.messageQueue.length > 0) {
      this.messageQueue.forEach((message) => {
        this.sendMessage(message);
      });
      this.messageQueue = [];
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.sendMessage({ type: "ping" });
      }
    }, this.heartbeatInterval);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Log debug messages if debug mode is enabled
   * (no logging occurs, preserved for compatibility)
   */
  private log(_message: string, ..._args: any[]): void {
    // Logging disabled due to removal of unnecessary logs
  }
}
