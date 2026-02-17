# Realtime Implementation Analysis & Future Directions

## What We Implemented

### 1. WebSocket Infrastructure

We built a complete realtime system using WebSockets:

**Backend Components:**

- **PostgreSQL Triggers**: Database triggers on key tables (`extraction_results`, `projects`, `extraction_jobs`, `supplier_matches`) that fire on INSERT/UPDATE/DELETE
- **PgListenerService**: NestJS service that listens to PostgreSQL NOTIFY events using `pg` library
- **RealtimeGateway**: WebSocket gateway using `@nestjs/websockets` that broadcasts database changes to connected clients
- **Channel-based subscriptions**: Clients subscribe to specific channels (table names) to receive relevant updates

**Frontend Components:**

- **WebSocket Connection**: Browser WebSocket client connects to backend gateway
- **Channel Subscriptions**: Frontend subscribes to channels like `extraction_results`, `projects`, etc.
- **Automatic Reconnection**: Exponential backoff reconnection logic for resilience

### 2. React Query Caching Strategy

We use TanStack Query (React Query) for data management:

**Cache Configuration:**

- **Stale Time**: 10 minutes for extraction results (data doesn't change frequently)
- **GC Time**: 10 minutes (cache retention)
- **Placeholder Data**: Keep previous data during updates to prevent UI flicker
- **Refetch Policies**: Refetch on window focus and network reconnection

**Query Structure:**

```typescript
{
  results: ExtractionResult[],
  schema: NormalizedExtractionSchema | null
}
```

### 3. Optimistic Updates

We implement optimistic updates for immediate UI feedback:

**Flow:**

1. User action (e.g., click "Accept" button)
2. **onMutate**: Immediately update local cache with expected result
3. API call to backend
4. **onSuccess**: Update cache with server response
5. **onError**: Rollback to previous state if mutation fails

**Example:**

```typescript
onMutate: async ({ resultId, status }) => {
  // Cancel ongoing queries
  await queryClient.cancelQueries({ queryKey });

  // Save previous state for rollback
  const prev = queryClient.getQueryData(queryKey);

  // Optimistically update cache
  queryClient.setQueryData(queryKey, (current) => ({
    ...current,
    results: current.results.map((r) =>
      r.id === resultId ? { ...r, status } : r
    )
  }));

  return { prev };
};
```

## How We Combined Caching + WebSockets

### The Hybrid Approach

We attempted to combine optimistic updates with realtime WebSocket updates:

1. **Optimistic Update**: User action → immediate UI update
2. **API Call**: Mutation sent to backend
3. **Server Response**: Backend returns updated data
4. **onSuccess Handler**: Update cache with server response
5. **Database Trigger**: PostgreSQL trigger fires → NOTIFY event
6. **WebSocket Broadcast**: Backend broadcasts change to all connected clients
7. **WebSocket Handler**: Frontend receives notification → updates cache

### Race Condition Prevention

To prevent conflicts between optimistic updates and WebSocket updates, we implemented:

```typescript
// Track recently mutated items
const recentlyMutatedRef = useRef<Map<string, number>>(new Map());

// In onSuccess:
recentlyMutatedRef.current.set(resultId, Date.now());
setTimeout(() => {
  recentlyMutatedRef.current.delete(resultId);
}, 1000);

// In WebSocket handler:
if (recentlyMutatedRef.current.has(itemId)) {
  const timeSinceMutation = Date.now() - mutationTime;
  if (timeSinceMutation < 1000) {
    return; // Ignore WebSocket update
  }
}
```

## The Problem: It Didn't Work

### Issue: Double Refresh Required

When clicking Accept/Undo button, the UI requires **two refreshes** before showing the latest value:

- **First refresh**: Shows optimistic update
- **Second refresh**: Shows actual database value

### Root Causes Identified

1. **Timing Conflicts**: Race condition between:
   - Mutation's `onSuccess` updating cache
   - WebSocket notification arriving and updating cache
   - React Query's internal cache reconciliation

2. **Data Structure Mismatch**:
   - Query returns `{ results: [], schema: {} }`
   - WebSocket handlers expect different structure
   - Cache updates may not properly merge

3. **Multiple Sources of Truth**:
   - Optimistic update (client prediction)
   - Server response (HTTP response)
   - WebSocket notification (database trigger)
   - React Query cache (local state)

4. **Ignore Window Issues**:
   - 1-second ignore window may be too short or too long
   - WebSocket updates might arrive before or after the window
   - No guarantee of ordering between HTTP response and WebSocket notification

## Alternative Approaches to Consider

### Option 1: WebSocket-Only Updates (Recommended)

**Concept**: Remove optimistic updates and rely solely on WebSockets for all data changes.

**Implementation:**

```typescript
// Remove onMutate (no optimistic updates)
// Remove onSuccess cache updates
// Let WebSocket be the single source of truth

const updateStatusMutation = useMutation({
  mutationFn: async ({ resultId, status }) => {
    const res = await apiPut(`/extraction/result/${resultId}/status`, {
      status
    });
    if (!res.ok) throw new Error("Failed to update status");
    return res.json();
  },
  // No onMutate - no optimistic update
  // No onSuccess - WebSocket will update cache
  onError: (error) => {
    // Show error toast
    toast.error("Failed to update status");
  }
});

// WebSocket handler updates cache
ws.onmessage = (event) => {
  const payload = JSON.parse(event.data);
  queryClient.setQueryData(queryKey, (current) => {
    // Apply update from WebSocket
    return updateCacheWithPayload(current, payload);
  });
};
```

**Pros:**

- Single source of truth (WebSocket)
- No race conditions between optimistic updates and WebSocket
- Simpler mental model
- Works for multi-user collaboration automatically

**Cons:**

- Slight delay before UI updates (network latency)
- Requires reliable WebSocket connection
- Need loading states during mutations

**Mitigation:**

- Show loading spinner during mutation
- Add optimistic UI hints (e.g., disabled state, opacity)
- Implement connection status indicator

### Option 2: Optimistic Updates with Invalidation

**Concept**: Keep optimistic updates but invalidate cache after mutation, forcing a refetch.

**Implementation:**

```typescript
const updateStatusMutation = useMutation({
  mutationFn: async ({ resultId, status }) => {
    // API call
  },
  onMutate: async ({ resultId, status }) => {
    // Optimistic update
    await queryClient.cancelQueries({ queryKey });
    const prev = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, optimisticUpdate);
    return { prev };
  },
  onSuccess: () => {
    // Invalidate and refetch to get fresh data
    queryClient.invalidateQueries({ queryKey });
  },
  onError: (_err, _vars, ctx) => {
    // Rollback on error
    if (ctx?.prev) {
      queryClient.setQueryData(queryKey, ctx.prev);
    }
  }
});

// Disable WebSocket updates entirely
// OR only use WebSocket for updates from other users
```

**Pros:**

- Immediate UI feedback (optimistic)
- Guaranteed consistency (refetch after mutation)
- Simpler than hybrid approach

**Cons:**

- Extra network request (refetch)
- Brief flicker when refetch completes
- Doesn't leverage WebSocket for own mutations

### Option 3: Server-Sent Events (SSE) Instead of WebSockets

**Concept**: Replace WebSockets with Server-Sent Events for simpler one-way communication.

**Implementation:**

```typescript
// Backend: SSE endpoint
@Sse('realtime/extraction-results/:jobId')
extractionResultsStream(@Param('jobId') jobId: string): Observable<MessageEvent> {
  return this.realtimeService.getExtractionResultsStream(jobId);
}

// Frontend: EventSource
useEffect(() => {
  const eventSource = new EventSource(`/api/realtime/extraction-results/${jobId}`);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    queryClient.setQueryData(queryKey, data);
  };

  return () => eventSource.close();
}, [jobId]);
```

**Pros:**

- Simpler than WebSockets (one-way only)
- Automatic reconnection built-in
- Works through HTTP/2
- No need for subscription management

**Cons:**

- One-way only (server → client)
- Less efficient than WebSockets for high-frequency updates
- Limited browser support for older browsers

### Option 4: Polling with Smart Invalidation

**Concept**: Use short polling intervals with smart cache invalidation.

**Implementation:**

```typescript
const { data } = useQuery({
  queryKey: qk.extraction.results(jobId),
  queryFn: fetchResults,
  refetchInterval: 2000, // Poll every 2 seconds
  refetchIntervalInBackground: false
  // Keep optimistic updates
  // Polling will eventually sync with server
});
```

**Pros:**

- Simple to implement
- No WebSocket infrastructure needed
- Works everywhere (no special server support)
- Guaranteed eventual consistency

**Cons:**

- Higher server load
- Increased latency (up to polling interval)
- Wasted requests when no changes
- Not truly realtime

### Option 5: Hybrid with Sequence Numbers

**Concept**: Add sequence numbers to track update ordering.

**Implementation:**

```typescript
// Backend: Add sequence number to each update
{
  id: "result-123",
  status: "accepted",
  version: 42, // Monotonically increasing
  updatedAt: "2024-11-13T20:00:00Z"
}

// Frontend: Only apply updates with higher version
queryClient.setQueryData(queryKey, (current) => {
  return current.results.map(item => {
    if (item.id === update.id && update.version > item.version) {
      return { ...item, ...update };
    }
    return item;
  });
});
```

**Pros:**

- Handles out-of-order updates correctly
- Works with both optimistic updates and WebSocket
- Prevents stale data from overwriting fresh data

**Cons:**

- Requires backend changes (version tracking)
- More complex implementation
- Need to handle version conflicts

## Recommended Next Steps

### Immediate Action: Try Option 1 (WebSocket-Only)

1. **Remove optimistic updates** from status mutation
2. **Remove onSuccess cache updates** - let WebSocket handle it
3. **Add loading states** to buttons during mutation
4. **Test thoroughly** - should work with single refresh

### If Option 1 Works:

- Apply same pattern to all mutations
- Add connection status indicator
- Implement optimistic UI hints (disabled states, loading spinners)
- Document the pattern for team

### If Option 1 Doesn't Work:

- Add extensive logging to trace update flow
- Check if WebSocket notifications are actually arriving
- Verify database triggers are firing
- Consider Option 5 (sequence numbers) for guaranteed ordering

### Long-term Improvements:

- Implement connection health monitoring
- Add retry logic for failed mutations
- Create reusable hooks for WebSocket-based mutations
- Build developer tools for debugging realtime updates
- Add E2E tests for realtime scenarios

## Conclusion

The hybrid approach of combining optimistic updates with WebSocket realtime updates proved too complex due to race conditions and multiple sources of truth. The recommended path forward is to simplify by using WebSockets as the single source of truth, removing optimistic updates, and relying on loading states for user feedback. This approach is simpler, more reliable, and naturally supports multi-user collaboration.
