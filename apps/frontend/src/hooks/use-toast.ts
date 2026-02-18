import { useState, useCallback } from "react";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

let listeners: Array<(toast: Toast) => void> = [];
let memoryState: Toast[] = [];

function dispatch(toast: Toast) {
  memoryState = [...memoryState, toast];
  listeners.forEach((listener) => listener(toast));
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>(memoryState);

  useState(() => {
    const listener = (toast: Toast) => {
      setToasts((prev) => [...prev, toast]);
    };
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  });

  const toast = useCallback(
    (props: Omit<Toast, "id">) => {
      const id = crypto.randomUUID();
      dispatch({ ...props, id });
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        memoryState = memoryState.filter((t) => t.id !== id);
      }, 3000);
    },
    [],
  );

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    memoryState = memoryState.filter((t) => t.id !== id);
  }, []);

  return { toasts, toast, dismiss };
}
