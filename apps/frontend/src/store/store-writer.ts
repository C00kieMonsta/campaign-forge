// createStoreWriter — the handle controllers use to write into the store. Each named change
// becomes one EntityChangeEvent fed through the single ingestEvents ingress. HTTP writes are
// stamped onto the shared monotonic seq; server (SSE) events arrive pre-stamped.
import {
  LexChangeOp,
  LexEventOrigin,
  type LexEntityChangeEvent,
  type LexEntityCollection,
  type LexProjectionMetaState
} from "@packages/types";
import { ingestEvents } from "./ingest";
import type { LexStore } from "./store";

export interface StoreWriter {
  upsert(collection: LexEntityCollection, entity: { id: string }): void;
  upsertMany(collection: LexEntityCollection, entities: { id: string }[]): void;
  replaceCollection(
    collection: LexEntityCollection,
    entities: { id: string }[]
  ): void;
  patch(
    collection: LexEntityCollection,
    entityId: string,
    patch: unknown
  ): void;
  remove(collection: LexEntityCollection, entityId: string): void;
  /** Feed server-authoritative events (already stamped) from the SSE entity-stream. */
  ingestServer(events: LexEntityChangeEvent[]): void;
}

type EventShape = Omit<
  LexEntityChangeEvent,
  "id" | "seq" | "epoch" | "timestamp" | "origin"
>;

function stamp(
  meta: LexProjectionMetaState,
  partial: EventShape
): LexEntityChangeEvent {
  const seq = meta.lastSeq + 1;
  return {
    id: `${meta.epoch}:${seq}`,
    seq,
    epoch: meta.epoch,
    timestamp: 0,
    origin: LexEventOrigin.HTTP,
    ...partial
  };
}

export function createStoreWriter(store: LexStore): StoreWriter {
  const ingest = (events: LexEntityChangeEvent[]): void =>
    ingestEvents(events)(store.dispatch, store.getState);
  const meta = (): LexProjectionMetaState => store.getState().lexProjectionMeta;

  return {
    upsert: (collection, entity) =>
      ingest([
        stamp(meta(), {
          collection,
          op: LexChangeOp.UPSERT,
          entityId: entity.id,
          payload: entity
        })
      ]),
    upsertMany: (collection, entities) => {
      if (entities.length === 0) return;
      ingest([
        stamp(meta(), {
          collection,
          op: LexChangeOp.UPSERT_MANY,
          payload: entities
        })
      ]);
    },
    replaceCollection: (collection, entities) =>
      ingest([
        stamp(meta(), {
          collection,
          op: LexChangeOp.REPLACE_COLLECTION,
          payload: entities
        })
      ]),
    patch: (collection, entityId, patch) =>
      ingest([
        stamp(meta(), {
          collection,
          op: LexChangeOp.PATCH,
          entityId,
          payload: patch
        })
      ]),
    remove: (collection, entityId) =>
      ingest([stamp(meta(), { collection, op: LexChangeOp.DELETE, entityId })]),
    ingestServer: (events) => ingest(events)
  };
}
