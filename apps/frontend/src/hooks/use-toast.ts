import { useState, useCallback, useEffect } from "react";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

type Action =
  | { type: "add"; toast: Toast }
  | { type: "remove"; id: string };

let memoryState: Toast[] = [];
const listeners: Set<(action: Action) => void> = new Set();

function dispatch(action: Action) {
  if (action.type === "add") {
    memoryState = [...memoryState, action.toast];
  } else {
    memoryState = memoryState.filter((t) => t.id !== action.id);
  }
  listeners.forEach((fn) => fn(action));
}

const AUTO_DISMISS_MS = 4000;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>(memoryState);

  useEffect(() => {
    const listener = (action: Action) => {
      if (action.type === "add") {
        setToasts((prev) => [...prev, action.toast]);
      } else {
        setToasts((prev) => prev.filter((t) => t.id !== action.id));
      }
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const toast = useCallback((props: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    dispatch({ type: "add", toast: { ...props, id } });
    setTimeout(() => dispatch({ type: "remove", id }), AUTO_DISMISS_MS);
  }, []);

  const dismiss = useCallback((id: string) => {
    dispatch({ type: "remove", id });
  }, []);

  return { toasts, toast, dismiss };
}
