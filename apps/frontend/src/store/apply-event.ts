// The projection's single write switch. Mutates entities in place (works on a plain object
// OR an Immer draft) so the entities-slice reducer uses ONE switch. Ported from remorai.
import { LexChangeOp, type LexEntityChangeEvent } from "@packages/types";
import type { LexEntitiesState } from "./entities-state";

export function applyEvent(
  entities: LexEntitiesState,
  e: LexEntityChangeEvent
): void {
  const store = entities as unknown as Record<string, Record<string, unknown>>;
  const collection = store[e.collection];

  switch (e.op) {
    case LexChangeOp.UPSERT: {
      const entity = e.payload as { id: string };
      collection[entity.id] = entity;
      break;
    }
    case LexChangeOp.UPSERT_MANY: {
      for (const entity of e.payload as { id: string }[]) {
        collection[entity.id] = entity;
      }
      break;
    }
    case LexChangeOp.PATCH: {
      const current = collection[e.entityId as string];
      if (current) {
        collection[e.entityId as string] = {
          ...(current as object),
          ...(e.payload as object)
        };
      }
      break;
    }
    case LexChangeOp.DELETE: {
      delete collection[e.entityId as string];
      break;
    }
    case LexChangeOp.REPLACE_COLLECTION: {
      const next: Record<string, unknown> = {};
      for (const entity of e.payload as { id: string }[])
        next[entity.id] = entity;
      store[e.collection] = next;
      break;
    }
    case LexChangeOp.RESET: {
      store[e.collection] = {};
      break;
    }
  }
}
