// Event-projection contract for the Lex client store. The SAME EntityChangeEvent is produced
// by controllers (HTTP responses) and by the backend SSE entity-stream, and reduced through
// ONE ingress (ingestEvents) into the normalized Redux store. One contract, no parallel defs.

/** The normalized store collections (keyed by the exposed @packages/types entity id). */
export type LexEntityCollection =
  | "lexWorkspaces"
  | "lexDocuments"
  | "lexConversations"
  | "lexMessages"
  | "lexArtifacts"
  | "lexArtifactVersions"
  | "lexAuthorities"
  | "lexTasks";

/** The six store write operations (collapses per-collection slice actions). */
export enum LexChangeOp {
  UPSERT = "upsert",
  UPSERT_MANY = "upsertMany",
  PATCH = "patch",
  DELETE = "delete",
  REPLACE_COLLECTION = "replaceCollection",
  RESET = "reset"
}

/** Where an event came from — the backend SSE stream, or a local HTTP response. */
export enum LexEventOrigin {
  SERVER = "server",
  HTTP = "http"
}

export interface LexEntityChangeEvent {
  /** Idempotency key (server event id, or `${epoch}:${seq}` for http events). */
  id: string;
  /** Arrival-order key on one monotonic counter (http + server share it). */
  seq: number;
  /** Server generation; changes on restart so stale-drop high-waters can reset. */
  epoch: string;
  timestamp: number;
  collection: LexEntityCollection;
  op: LexChangeOp;
  entityId?: string;
  payload?: unknown;
  origin: LexEventOrigin;
}

export interface LexProjectionMetaState {
  lastSeq: number;
  epoch: string;
  entitySeq: Record<string, number>;
  appliedIds: string[];
}

/**
 * A frame on the backend SSE entity-stream. A `change` frame carries a server-authoritative
 * event; when a row is too large to inline (payload omitted), the client refetches the entity
 * and upserts it. `resync` tells the client to refetch its open workspace; `keepalive` is ignored.
 */
export type LexRealtimeFrame =
  | { type: "change"; event: LexEntityChangeEvent }
  | { type: "resync" }
  | { type: "keepalive" };
