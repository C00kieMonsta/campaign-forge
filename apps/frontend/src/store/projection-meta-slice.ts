import type {
  LexEntityChangeEvent,
  LexProjectionMetaState
} from "@packages/types";
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

const initialState: LexProjectionMetaState = {
  lastSeq: 0,
  epoch: "init",
  entitySeq: {},
  appliedIds: []
};

/**
 * `projectionApplied` is the single write action — reduced by BOTH this slice (records the
 * new meta) and the entities slice (applies the events). ingestEvents is its only dispatcher.
 */
export const projectionMetaSlice = createSlice({
  name: "lexProjectionMeta",
  initialState,
  reducers: {
    projectionApplied: (
      _state,
      action: PayloadAction<{
        events: LexEntityChangeEvent[];
        meta: LexProjectionMetaState;
      }>
    ) => action.payload.meta
  }
});

export const { projectionApplied } = projectionMetaSlice.actions;
