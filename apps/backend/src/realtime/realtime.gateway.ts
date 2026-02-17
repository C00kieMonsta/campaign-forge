import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import { Server, WebSocket } from "ws";
import { PgListenerService } from "./pg-listener.service";

interface SubscribeMessage {
  type: "subscribe" | "unsubscribe";
  channel: string;
}

@WebSocketGateway({
  path: "/ws",
  transports: ["websocket"],
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    credentials: true
  }
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;

  // Map of WebSocket connections to their subscribed channels
  private rooms = new Map<WebSocket, Set<string>>();

  constructor(private readonly pgListener: PgListenerService) {
    // Set up handler to receive notifications from PgListener
    this.pgListener.setHandler((channel, payload) => {
      try {
        this.broadcast(channel, payload);
      } catch (error) {
        console.error(
          `[RealtimeGateway] Error broadcasting notification on channel ${channel}:`,
          error
        );
      }
    });
  }

  handleConnection(client: WebSocket) {
    const clientId = this.getClientId(client);
    this.rooms.set(client, new Set());
    // Suppress client connection logs - not helpful for debugging

    client.on("message", (raw) => {
      try {
        const rawMessage = String(raw);
        const msg: SubscribeMessage = JSON.parse(rawMessage);

        // Suppress ping/pong heartbeat messages
        if (msg.type === "ping" || msg.type === "pong") {
          return;
        }

        if (!msg.type) {
          console.warn(
            `[RealtimeGateway] Message missing 'type' field from client (${clientId})`
          );
          return;
        }

        if (msg.type === "subscribe" && typeof msg.channel === "string") {
          this.rooms.get(client)?.add(msg.channel);
          // Suppress subscription logs - too chatty
        } else if (
          msg.type === "unsubscribe" &&
          typeof msg.channel === "string"
        ) {
          this.rooms.get(client)?.delete(msg.channel);
          // Suppress unsubscription logs - too chatty
        } else {
          console.warn(
            `[RealtimeGateway] Invalid message format from client (${clientId}):`,
            msg
          );
        }
      } catch (error) {
        console.error(
          `[RealtimeGateway] Failed to parse WebSocket message from client (${clientId}):`,
          error
        );
        console.error(`[RealtimeGateway] Raw message was: ${String(raw)}`);
      }
    });

    client.on("error", (error) => {
      console.error(
        `[RealtimeGateway] WebSocket error for client (${clientId}):`,
        error
      );
    });
  }

  handleDisconnect(client: WebSocket) {
    const clientId = this.getClientId(client);
    this.rooms.delete(client);
    // Suppress client disconnection logs - not helpful for debugging
  }

  private broadcast(channel: string, payload: string) {
    let sentCount = 0;
    let skippedCount = 0;

    try {
      // Validate payload is valid JSON
      JSON.parse(payload);
    } catch (error) {
      console.error(
        `[RealtimeGateway] Invalid JSON payload for channel ${channel}:`,
        error
      );
      console.error(`[RealtimeGateway] Payload was: ${payload}`);
      return;
    }

    for (const [ws, subscriptions] of this.rooms.entries()) {
      if (subscriptions.has(channel)) {
        if (ws.readyState === ws.OPEN) {
          try {
            ws.send(payload);
            sentCount++;
          } catch (error) {
            console.error(
              `[RealtimeGateway] Failed to send message to client (${this.getClientId(ws)}):`,
              error
            );
          }
        } else {
          skippedCount++;
          console.warn(
            `[RealtimeGateway] Skipped client (${this.getClientId(ws)}) - connection not open (state: ${ws.readyState})`
          );
        }
      }
    }

    if (sentCount > 0) {
      console.log(
        `[RealtimeGateway] Broadcast to ${sentCount} client(s) on channel: ${channel}${skippedCount > 0 ? ` (skipped ${skippedCount} closed connections)` : ""}`
      );
    } else {
      console.log(
        `[RealtimeGateway] No active subscribers for channel: ${channel}`
      );
    }
  }

  private getClientId(client: WebSocket): string {
    // Generate a simple identifier for logging purposes
    return `${(client as any)._socket?.remoteAddress || "unknown"}:${(client as any)._socket?.remotePort || "unknown"}`;
  }
}
