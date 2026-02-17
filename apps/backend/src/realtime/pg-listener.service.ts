import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Client } from "pg";

type NotificationHandler = (channel: string, payload: string) => void;

@Injectable()
export class PgListenerService implements OnModuleInit, OnModuleDestroy {
  private client: Client | null = null;
  private dbUrl: string | undefined;
  private channels: string[];
  private handler: NotificationHandler | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isDestroyed = false;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000; // Max 30 seconds between retries

  constructor() {
    this.dbUrl =
      process.env.DATABASE_URL_DIRECT || process.env.DIRECT_DATABASE_URL;
    if (!this.dbUrl) {
      console.warn(
        JSON.stringify({
          level: "warn",
          action: "pgListenerConfigMissing",
          message:
            "DATABASE_URL_DIRECT/DIRECT_DATABASE_URL not configured, WebSocket notifications will not work"
        })
      );
      this.channels = [];
      return;
    }

    this.channels = (
      process.env.PG_CHANNELS || "extraction_jobs,projects,supplier_matches"
    )
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    console.log(
      JSON.stringify({
        level: "info",
        action: "pgListenerInitialized",
        channels: this.channels
      })
    );
  }

  async onModuleInit() {
    // Don't block module initialization - connect asynchronously
    // This allows the HTTP server to start even if DB connection is delayed
    this.connect().catch((error) => {
      console.error(
        JSON.stringify({
          level: "error",
          action: "pgListenerInitFailed",
          message: "Failed to initialize PgListener, will retry in background",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );
      // Connection will retry automatically via scheduleReconnect
    });
  }

  async onModuleDestroy() {
    this.isDestroyed = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.client) {
      try {
        await this.client.end();
      } catch (error) {
        console.error("[PgListener] Error during cleanup:", error);
      }
      this.client = null;
    }
  }

  private async connect() {
    // Don't reconnect if module is being destroyed
    if (this.isDestroyed) {
      return;
    }

    // Skip connection if no channels configured (DATABASE_URL_DIRECT missing)
    if (this.channels.length === 0) {
      return;
    }

    try {
      // Close old client if it exists
      if (this.client) {
        try {
          await this.client.end();
        } catch (error) {
          // Silently ignore error during cleanup
        }
      }

      // Create NEW client instance (don't reuse old one)
      if (!this.dbUrl) {
        throw new Error("Database URL not configured");
      }

      this.client = new Client({
        connectionString: this.dbUrl,
        ssl:
          process.env.NODE_ENV === "production"
            ? true
            : { rejectUnauthorized: false } // Allow self-signed certs in dev
      });

      await this.client.connect();

      // Listen to all configured channels
      for (const channel of this.channels) {
        await this.client.query(`LISTEN ${channel}`);
      }

      // Handle notifications
      this.client.on("notification", (msg) => {
        if (this.handler && msg.channel && msg.payload) {
          try {
            this.handler(msg.channel, msg.payload);
          } catch (error) {
            console.error(
              `[PgListener] Error handling notification on channel ${msg.channel}:`,
              error
            );
          }
        }
      });

      // Handle connection errors
      this.client.on("error", (err) => {
        console.error(
          JSON.stringify({
            level: "error",
            action: "pgListenerConnectionError",
            error: err instanceof Error ? err.message : "Unknown error"
          })
        );
        this.scheduleReconnect();
      });

      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;

      console.log(
        JSON.stringify({
          level: "info",
          action: "pgListenerReady",
          channels: this.channels,
          message: "Successfully connected and listening"
        })
      );
    } catch (error) {
      // Only log connection failures if explicitly debugging
      if (process.env.LOG_LEVEL === "debug") {
        console.warn(
          JSON.stringify({
            level: "warn",
            action: "pgListenerConnectFailed",
            error: error instanceof Error ? error.message : "Unknown error",
            message: "Will retry connection in background",
            attempt: this.reconnectAttempts + 1
          })
        );
      }
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) {
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    this.reconnectAttempts++;

    // Only log reconnection if explicitly debugging (LOG_LEVEL=debug)
    if (process.env.LOG_LEVEL === "debug") {
      console.warn(
        JSON.stringify({
          level: "warn",
          action: "pgListenerReconnectScheduled",
          delay,
          attempt: this.reconnectAttempts,
          message: "PgListener will retry connection in background"
        })
      );
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  setHandler(handler: NotificationHandler) {
    this.handler = handler;
  }
}
