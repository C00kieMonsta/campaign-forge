// The ONLY write entry point into the store projection. Plans (dedup + stale-drop) then
// dispatches ONE projectionApplied that both slices reduce.
import type { LexEntityChangeEvent } from "@packages/types";
import type { Dispatch, UnknownAction } from "@reduxjs/toolkit";
import { planIngestion } from "./plan-ingestion";
import { projectionApplied } from "./projection-meta-slice";
import type { RootState } from "./store";

export const ingestEvents =
  (events: LexEntityChangeEvent[]) =>
  (dispatch: Dispatch<UnknownAction>, getState: () => RootState): void => {
    if (events.length === 0) return;
    const { toApply, nextMeta } = planIngestion(
      getState().lexProjectionMeta,
      events
    );
    dispatch(projectionApplied({ events: toApply, meta: nextMeta }));
  };
