import { configureStore } from "@reduxjs/toolkit";
import { entitiesSlice } from "./entities-slice";
import { projectionMetaSlice } from "./projection-meta-slice";

export function createLexStore() {
  return configureStore({
    reducer: {
      lexEntities: entitiesSlice.reducer,
      lexProjectionMeta: projectionMetaSlice.reducer
    }
  });
}

export const lexStore = createLexStore();

export type LexStore = ReturnType<typeof createLexStore>;
export type RootState = ReturnType<LexStore["getState"]>;
export type AppDispatch = LexStore["dispatch"];
