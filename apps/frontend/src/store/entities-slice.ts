import { createSlice } from "@reduxjs/toolkit";
import { applyEvent } from "./apply-event";
import { emptyEntitiesState, type LexEntitiesState } from "./entities-state";
import { projectionApplied } from "./projection-meta-slice";

export const entitiesSlice = createSlice({
  name: "lexEntities",
  initialState: emptyEntitiesState(),
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(projectionApplied, (state, action) => {
      for (const e of action.payload.events) {
        applyEvent(state as unknown as LexEntitiesState, e);
      }
    });
  }
});
