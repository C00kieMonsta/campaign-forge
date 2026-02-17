# WebSocket Real-Time Layer Design

## Overview

This design implements a lightweight WebSocket-based real-time notification system that enables the UI to receive instant updates when database records change. The architecture uses Postgres NOTIFY/LISTEN for change detection, NestJS WebSocket gateway for broadcasting, and TanStack Query cache patching on the frontend for seamless updates without page refreshes.

### Key Design Principles

1. **Minimal Infrastructure**: No Redis or external message broker required
2. **Database-Driven**: Postgres triggers automatically emit change notifications
3. **Cache Patching**: Updates modify existing TanStack Query cache rather than full refetches
4. **Graceful Degradation**: System continues to function if WebSocket connection fails
5. **Selective Subscriptions**: Clients only receive updates for channels they subscribe to

## Architecture

### High-Level Flow

```
Database Change → Postgres NOTIFY → PgListener Service → Realtime Gateway → WebSocket Clients → Cache Update
```

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  React Components                                         │  │
│  │  - useProjects() + useProjectsLive()                     │  │
│  │  - useExtractionJobs() + useExtractionJobsLive()        │  │
│  └────────────────┬─────────────────────────────────────────┘  │
│                   │                                              │
│  ┌────────────────▼─────────────────────────────────────────┐  │
│  │  TanStack Query Cache                                     │  │
│  │  - Stores fetched data                                    │  │
│  │  - Receives incremental updates via setQueryData()       │  │
│  └────────────────┬─────────────────────────────────────────┘  │
│                   │                                              │
│  ┌────────────────▼─────────────────────────────────────────┐  │
│  │  WebSocket Client (useRealtimeSubscription hook)         │  │
│  │  - Connects to wss://api.example.com/ws                  │  │
│  │  - Sends subscribe/unsubscribe messages                  │  │
│  │  - Patches cache on notification receipt                 │  │
│  └────────────────┬─────────────────────────────────────────┘  │
└────────────────────┼─────────────────────────────────────────────┘
                     │ WebSocket Connection
┌────────────────────▼─────────────────────────────────────────────┐
│                      Backend (NestJS)                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  RealtimeGateway (@WebSocketGateway)                     │  │
│  │  - Handles WebSocket connections                         │  │
│  │  - Manages client subscriptions (Map<WebSocket, Set>)    │  │
│  │  - Broadcasts notifications to subscribed clients        │  │
│  └────────────────┬─────────────────────────────────────────┘  │
│                   │                                              │
│  ┌────────────────▼─────────────────────────────────────────┐  │
│  │  PgListenerService                                        │  │
│  │  - Maintains persistent Postgres connection              │  │
│  │  - Executes LISTEN commands for configured channels      │  │
│  │  - Forwards notifications to RealtimeGateway             │  │
│  └────────────────┬─────────────────────────────────────────┘  │
└────────────────────┼─────────────────────────────────────────────┘
                     │ LISTEN/NOTIFY
┌────────────────────▼─────────────────────────────────────────────┐
│                  Database (Supabase Postgres)                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Tables: projects, extraction_jobs, extraction_results   │  │
│  │  - After INSERT/UPDATE/DELETE triggers                   │  │
│  │  - Call notify_row_change() function                     │  │
│  │  - Emit pg_notify(table_name, json_payload)             │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Database Layer

#### Notification Function

A reusable Postgres function that can be attached to any table via triggers:

```sql
CREATE OR REPLACE FUNCTION notify_row_change()
RETURNS trigger AS $$
DECLARE
  payload jsonb;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    payload := jsonb_build_object(
      'op', 'DELETE',
      'table', TG_TABLE_NAME,
      'old', to_jsonb(old)
    );
  ELSE
    payload := jsonb_build_object(
      'op', TG_OP,
      'table', TG_TABLE_NAME,
      'new', to_jsonb(new)
    );
  END IF;

  PERFORM pg_notify(TG_TABLE_NAME, payload::text);
  RETURN null;
END;
$$ LANGUAGE plpgsql;
```

#### Table Triggers

Triggers are created for each table that requires real-time updates:

```sql
-- Example for extraction_jobs table
DROP TRIGGER IF EXISTS t_extraction_jobs_notify ON extraction_jobs;
CREATE TRIGGER t_extraction_jobs_notify
AFTER INSERT OR UPDATE OR DELETE ON extraction_jobs
FOR EACH ROW EXECUTE FUNCTION notify_row_change();
```

**Tables to Monitor:**

- `extraction_jobs` - Job status updates
- `extraction_results` - New extraction results
- `projects` - Project changes
- `data_layers` - File upload/processing status
- `supplier_matches` - Supplier matching results

#### Notification Payload Structure

```typescript
interface NotificationPayload {
  op: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  new?: Record<string, any>; // Present for INSERT and UPDATE
  old?: Record<string, any>; // Present for DELETE
}
```

### 2. Backend Layer (NestJS)

#### PgListenerService

**Responsibility**: Maintain a persistent connection to Postgres and listen for NOTIFY events.

**File**: `apps/backend/src/realtime/pg-listener.service.ts`

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Client } from "pg";

type NotificationHandler = (channel: string, payload: string) => void;

@Injectable()
export class PgListenerService implements OnModuleInit, OnModuleDestroy {
  private client: Client;
  private channels: string[];
  private handler: NotificationHandler | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.client = new Client({
      connectionString: process.env.DATABASE_URL_DIRECT
    });
    this.channels = (
      process.env.PG_CHANNELS || "extraction_jobs,projects"
    ).split(",");
  }

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    try {
      await this.client.end();
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  private async connect() {
    try {
      await this.client.connect();

      // Listen to all configured channels
      for (const channel of this.channels) {
        await this.client.query(`LISTEN ${channel}`);
      }

      // Handle notifications
      this.client.on("notification", (msg) => {
        if (this.handler && msg.channel && msg.payload) {
          this.handler(msg.channel, msg.payload);
        }
      });

      // Handle connection errors
      this.client.on("error", (err) => {
        console.error("PgListener connection error:", err);
        this.scheduleReconnect();
      });

      console.log(
        `PgListener connected and listening to: ${this.channels.join(", ")}`
      );
    } catch (error) {
      console.error("Failed to connect PgListener:", error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) return;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 1000);
  }

  setHandler(handler: NotificationHandler) {
    this.handler = handler;
  }
}
```

**Key Features:**

- Uses `DATABASE_URL_DIRECT` (port 5432) instead of PgBouncer connection
- Automatically reconnects on connection failure with 1-second delay
- Configurable channels via `PG_CHANNELS` environment variable
- Single handler pattern for simplicity

#### RealtimeGateway

**Responsibility**: Manage WebSocket connections and broadcast notifications to subscribed clients.

**File**: `apps/backend/src/realtime/realtime.gateway.ts`

```typescript
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
      this.broadcast(channel, payload);
    });
  }

  handleConnection(client: WebSocket) {
    this.rooms.set(client, new Set());
    console.log("WebSocket client connected");

    client.on("message", (raw) => {
      try {
        const msg: SubscribeMessage = JSON.parse(String(raw));

        if (msg.type === "subscribe" && typeof msg.channel === "string") {
          this.rooms.get(client)?.add(msg.channel);
          console.log(`Client subscribed to: ${msg.channel}`);
        }

        if (msg.type === "unsubscribe" && typeof msg.channel === "string") {
          this.rooms.get(client)?.delete(msg.channel);
          console.log(`Client unsubscribed from: ${msg.channel}`);
        }
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    });
  }

  handleDisconnect(client: WebSocket) {
    this.rooms.delete(client);
    console.log("WebSocket client disconnected");
  }

  private broadcast(channel: string, payload: string) {
    let sentCount = 0;

    for (const [ws, subscriptions] of this.rooms.entries()) {
      if (ws.readyState === ws.OPEN && subscriptions.has(channel)) {
        ws.send(payload);
        sentCount++;
      }
    }

    if (sentCount > 0) {
      console.log(`Broadcast to ${sentCount} clients on channel: ${channel}`);
    }
  }
}
```

**Key Features:**

- Lightweight room management using Map and Set
- Only broadcasts to clients subscribed to the specific channel
- Handles subscribe/unsubscribe messages from clients
- Cleans up subscriptions on disconnect

#### RealtimeModule

**File**: `apps/backend/src/realtime/realtime.module.ts`

```typescript
import { Module } from "@nestjs/common";
import { PgListenerService } from "./pg-listener.service";
import { RealtimeGateway } from "./realtime.gateway";

@Module({
  providers: [PgListenerService, RealtimeGateway],
  exports: [PgListenerService]
})
export class RealtimeModule {}
```

#### Integration with AppModule

Update `apps/backend/src/app.module.ts` to import RealtimeModule:

```typescript
import { RealtimeModule } from "@/realtime/realtime.module";

@Module({
  imports: [
    // ... existing imports
    RealtimeModule
  ]
  // ... rest of module config
})
export class AppModule {}
```

### 3. Frontend Layer (Next.js)

#### WebSocket Client Hook

**File**: `apps/frontend/src/hooks/use-realtime-subscription.ts`

```typescript
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface NotificationPayload<T = any> {
  op: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  new?: T;
  old?: T;
}

interface UseRealtimeSubscriptionOptions<T> {
  channel: string;
  queryKey: any[];
  enabled?: boolean;
  onInsert?: (data: T, current: T[]) => T[];
  onUpdate?: (data: T, current: T[]) => T[];
  onDelete?: (data: T, current: T[]) => T[];
}

export function useRealtimeSubscription<T extends { id: string }>({
  channel,
  queryKey,
  enabled = true,
  onInsert,
  onUpdate,
  onDelete
}: UseRealtimeSubscriptionOptions<T>) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const connect = () => {
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
      if (!wsUrl) {
        console.error("NEXT_PUBLIC_WS_URL not configured");
        return;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`WebSocket connected, subscribing to: ${channel}`);
        ws.send(JSON.stringify({ type: "subscribe", channel }));
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const payload: NotificationPayload<T> = JSON.parse(event.data);

          queryClient.setQueryData<T[]>(queryKey, (current = []) => {
            switch (payload.op) {
              case "INSERT":
                if (!payload.new) return current;
                if (onInsert) return onInsert(payload.new, current);
                // Default: add to beginning if not already present
                return current.some((item) => item.id === payload.new!.id)
                  ? current
                  : [payload.new, ...current];

              case "UPDATE":
                if (!payload.new) return current;
                if (onUpdate) return onUpdate(payload.new, current);
                // Default: merge update with existing item
                return current.map((item) =>
                  item.id === payload.new!.id
                    ? { ...item, ...payload.new }
                    : item
                );

              case "DELETE":
                if (!payload.old) return current;
                if (onDelete) return onDelete(payload.old, current);
                // Default: remove by id
                return current.filter((item) => item.id !== payload.old!.id);

              default:
                return current;
            }
          });
        } catch (error) {
          console.error("Failed to process WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (reconnectTimeoutRef.current) return;

      const delay = Math.min(
        1000 * Math.pow(2, reconnectAttempts.current),
        30000
      );
      reconnectAttempts.current++;

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connect();
      }, delay);
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [channel, enabled, queryKey, queryClient, onInsert, onUpdate, onDelete]);
}
```

**Key Features:**

- Automatic reconnection with exponential backoff (max 30 seconds)
- Resubscribes to channel on reconnect
- Default handlers for INSERT/UPDATE/DELETE operations
- Custom handlers for complex update logic
- Idempotent updates (prevents duplicates)

#### Example Usage Hooks

**File**: `apps/frontend/src/hooks/use-projects-live.ts`

```typescript
import type { Project } from "@packages/utils";
import { qk } from "@/lib/query-keys";
import { useRealtimeSubscription } from "./use-realtime-subscription";

export function useProjectsLive(clientId?: string, enabled = true) {
  useRealtimeSubscription<Project>({
    channel: "projects",
    queryKey: qk.projects.list({ clientId: clientId || "" }),
    enabled,
    // Custom insert handler to maintain sort order
    onInsert: (newProject, current) => {
      if (current.some((p) => p.id === newProject.id)) return current;
      return [newProject, ...current].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }
  });
}
```

**File**: `apps/frontend/src/hooks/use-extraction-jobs-live.ts`

```typescript
import type { ExtractionJob } from "@packages/utils";
import { qk } from "@/lib/query-keys";
import { useRealtimeSubscription } from "./use-realtime-subscription";

export function useExtractionJobsLive(projectId?: string, enabled = true) {
  useRealtimeSubscription<ExtractionJob>({
    channel: "extraction_jobs",
    queryKey: qk.extraction.jobs(projectId || ""),
    enabled
  });
}
```

#### Component Integration

```typescript
"use client";

import { useProjects } from '@/hooks/use-projects';
import { useProjectsLive } from '@/hooks/use-projects-live';

export function ProjectsList({ clientId }: { clientId?: string }) {
  const { data: projects, isLoading } = useProjects(clientId);

  // Enable real-time updates
  useProjectsLive(clientId);

  if (isLoading) return <div>Loading...</div>;

  return (
    <ul>
      {projects?.map(project => (
        <li key={project.id}>{project.name}</li>
      ))}
    </ul>
  );
}
```

## Data Models

### Environment Variables

#### Backend (.env)

```bash
# Direct Postgres connection for LISTEN/NOTIFY (port 5432, not PgBouncer)
DATABASE_URL_DIRECT=postgresql://user:pass@host:5432/db?sslmode=require

# Comma-separated list of table names to monitor
PG_CHANNELS=extraction_jobs,extraction_results,projects,data_layers,supplier_matches

# Frontend URL for CORS
FRONTEND_URL=https://app.example.com
```

#### Frontend (.env.local)

```bash
# WebSocket endpoint
NEXT_PUBLIC_WS_URL=wss://api.example.com/ws
```

### Query Key Structure

Maintain consistency with existing query key patterns:

```typescript
// apps/frontend/src/lib/query-keys.ts
export const qk = {
  projects: {
    list: (filters: { clientId: string }) => ["projects", "list", filters],
    detail: (id: string) => ["projects", "detail", id]
  },
  extraction: {
    jobs: (projectId: string) => ["extraction", "jobs", projectId],
    results: (jobId: string) => ["extraction", "results", jobId]
  }
  // ... other keys
};
```

## Error Handling

### Backend Error Scenarios

1. **PgListener Connection Failure**
   - Automatic reconnection after 1 second
   - Logs error but continues serving HTTP requests
   - WebSocket clients remain connected but won't receive updates until reconnected

2. **Invalid Notification Payload**
   - Log error and skip the notification
   - Don't crash the service

3. **WebSocket Client Errors**
   - Gracefully handle malformed messages
   - Clean up subscriptions on disconnect

### Frontend Error Scenarios

1. **WebSocket Connection Failure**
   - Exponential backoff reconnection (1s, 2s, 4s, 8s, 16s, 30s max)
   - UI continues to function with cached data
   - Manual refetch still available

2. **Invalid Notification Data**
   - Log error and skip the update
   - Don't crash the component

3. **Cache Update Conflicts**
   - Use optimistic updates where appropriate
   - Rely on eventual consistency

## Testing Strategy

### Unit Tests

#### Backend

1. **PgListenerService**
   - Test connection establishment
   - Test reconnection logic
   - Test handler invocation
   - Mock pg.Client

2. **RealtimeGateway**
   - Test subscription management
   - Test broadcast filtering
   - Test cleanup on disconnect
   - Mock WebSocket connections

#### Frontend

1. **useRealtimeSubscription**
   - Test INSERT/UPDATE/DELETE handlers
   - Test reconnection logic
   - Test subscription lifecycle
   - Mock WebSocket

### Integration Tests

1. **End-to-End Notification Flow**
   - Insert a record in the database
   - Verify notification received by WebSocket client
   - Verify cache updated correctly

2. **Multi-Client Broadcasting**
   - Connect multiple WebSocket clients
   - Verify all subscribed clients receive notifications
   - Verify unsubscribed clients don't receive notifications

3. **Reconnection Scenarios**
   - Simulate connection drops
   - Verify automatic reconnection
   - Verify resubscription after reconnect

### Manual Testing Checklist

- [ ] Create a project and verify it appears in real-time on another browser tab
- [ ] Update extraction job status and verify UI updates without refresh
- [ ] Delete a record and verify it disappears from UI
- [ ] Disconnect network and verify graceful degradation
- [ ] Reconnect network and verify automatic recovery
- [ ] Test with multiple concurrent users
- [ ] Verify no duplicate entries appear
- [ ] Test performance with high-frequency updates

## Performance Considerations

### Database

- **Trigger Overhead**: Minimal, as triggers only call pg_notify()
- **Payload Size**: Keep payloads small (< 8KB per notification)
- **Notification Rate**: Postgres can handle thousands of notifications per second

### Backend

- **Memory Usage**: O(n) where n = number of connected clients
- **CPU Usage**: Minimal, just JSON parsing and forwarding
- **Connection Pooling**: PgListener uses a single dedicated connection

### Frontend

- **Cache Updates**: Efficient, only modifies affected items
- **Reconnection**: Exponential backoff prevents thundering herd
- **Memory**: No additional storage beyond existing TanStack Query cache

## Security Considerations

### Authentication

- WebSocket connections should validate JWT tokens (future enhancement)
- For MVP, rely on CORS and same-origin policy

### Authorization

- Notifications contain full row data
- For sensitive data, include only IDs and let client refetch details
- Consider organization-scoped channels (e.g., `projects:org-123`)

### Data Filtering

```typescript
// Example: Filter notifications by organization
private broadcast(channel: string, payload: string) {
  const data = JSON.parse(payload);

  for (const [ws, subscriptions] of this.rooms.entries()) {
    if (ws.readyState === ws.OPEN && subscriptions.has(channel)) {
      // Future: Check if client has access to data.organizationId
      ws.send(payload);
    }
  }
}
```

## Migration Strategy

### Phase 1: Infrastructure Setup

1. Install dependencies (`ws`, `@nestjs/websockets`, `@nestjs/platform-ws`, `pg`)
2. Create database triggers for monitored tables
3. Deploy PgListenerService and RealtimeGateway
4. Configure environment variables

### Phase 2: Frontend Integration

1. Create `useRealtimeSubscription` hook
2. Create table-specific live hooks (e.g., `useProjectsLive`)
3. Add live hooks to existing components
4. Test with feature flags to enable gradually

### Phase 3: Optimization

1. Add authentication to WebSocket connections
2. Implement organization-scoped channels
3. Add metrics and monitoring
4. Optimize payload sizes

## Monitoring and Observability

### Metrics to Track

- Number of active WebSocket connections
- Notification broadcast rate per channel
- PgListener reconnection frequency
- Frontend reconnection attempts
- Cache update success/failure rate

### Logging

- Backend: Log connection events, errors, and broadcast counts
- Frontend: Log connection state changes and update errors
- Database: Consider logging high-frequency notification patterns

## Future Enhancements

1. **Authentication**: Validate JWT tokens on WebSocket connection
2. **Presence**: Track which users are viewing which resources
3. **Typing Indicators**: Show when other users are editing
4. **Conflict Resolution**: Handle concurrent edits
5. **Selective Fields**: Only broadcast changed fields, not entire rows
6. **Compression**: Use WebSocket compression for large payloads
7. **Horizontal Scaling**: Use Redis pub/sub when scaling beyond single server
