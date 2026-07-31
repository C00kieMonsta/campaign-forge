// Pure ingestion planner (ported from remorai): dedup by event id (bounded window) + an
// epoch-scoped, per-entity stale-drop by high-water seq. No store, no I/O.
import {
  LexChangeOp,
  type LexEntityChangeEvent,
  type LexProjectionMetaState
} from "@packages/types";

export const APPLIED_IDS_WINDOW = 500;

const entityKey = (e: LexEntityChangeEvent): string =>
  `${e.collection}:${e.entityId}`;

const clearsHighWater = (op: LexEntityChangeEvent["op"]): boolean =>
  op === LexChangeOp.REPLACE_COLLECTION || op === LexChangeOp.RESET;

export interface IngestionPlan {
  toApply: LexEntityChangeEvent[];
  nextMeta: LexProjectionMetaState;
}

export function planIngestion(
  meta: LexProjectionMetaState,
  incoming: LexEntityChangeEvent[]
): IngestionPlan {
  let epoch = meta.epoch;
  let lastSeq = meta.lastSeq;
  let entitySeq: Record<string, number> = { ...meta.entitySeq };
  let appliedIds = [...meta.appliedIds];
  const applied = new Set(appliedIds);
  const toApply: LexEntityChangeEvent[] = [];

  for (const e of incoming) {
    // New server generation → clear stale-drop high-waters (never the dedup window).
    if (e.epoch !== epoch) {
      epoch = e.epoch;
      entitySeq = {};
    }

    if (applied.has(e.id)) continue; // dedup

    if (e.entityId !== undefined) {
      const key = entityKey(e);
      const highWater = entitySeq[key];
      if (highWater !== undefined && e.seq <= highWater) {
        applied.add(e.id);
        appliedIds.push(e.id);
        continue; // stale
      }
      entitySeq[key] = e.seq;
    }

    if (clearsHighWater(e.op)) entitySeq = {};

    applied.add(e.id);
    appliedIds.push(e.id);
    lastSeq = Math.max(lastSeq, e.seq);
    toApply.push(e);
  }

  if (appliedIds.length > APPLIED_IDS_WINDOW) {
    appliedIds = appliedIds.slice(appliedIds.length - APPLIED_IDS_WINDOW);
  }

  return { toApply, nextMeta: { lastSeq, epoch, entitySeq, appliedIds } };
}
