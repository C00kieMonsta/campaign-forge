import { useMemo } from "react";
import { createSelector } from "@reduxjs/toolkit";
import {
  useDispatch,
  useSelector,
  type TypedUseSelectorHook
} from "react-redux";
import type { LexEntityType, LexEntityTypeMap } from "./entities-state";
import type { AppDispatch, RootState } from "./store";

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export type EntityFilter<T> = (entity: T) => boolean;

/** Read a collection from the normalized store, optionally filtered (memoized selector). */
export function useCollection<T extends LexEntityType>(
  type: T,
  filter?: EntityFilter<LexEntityTypeMap[T]>
): LexEntityTypeMap[T][] {
  const select = useMemo(
    () =>
      createSelector(
        [
          (s: RootState) =>
            s.lexEntities[type] as Record<string, LexEntityTypeMap[T]>
        ],
        (record) => {
          const entities = Object.values(record);
          return filter ? entities.filter(filter) : entities;
        }
      ),
    [type, filter]
  );
  return useAppSelector(select);
}

/** Read a single entity by id from the normalized store. */
export function useEntity<T extends LexEntityType>(
  type: T,
  id: string | undefined
): LexEntityTypeMap[T] | undefined {
  return useAppSelector((s) =>
    id
      ? (s.lexEntities[type] as Record<string, LexEntityTypeMap[T]>)[id]
      : undefined
  );
}
