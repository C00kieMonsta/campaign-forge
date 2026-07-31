import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Provider } from "react-redux";
import { createControllers, type LexControllers } from "./controllers";
import { lexStore } from "./store";
import { createStoreWriter } from "./store-writer";

const ControllersContext = createContext<LexControllers | null>(null);

/**
 * Provides the Lex Redux store + the controllers that write into it. Scoped to the Lex
 * feature (other admin pages ignore it).
 */
export function LexStoreProvider({ children }: { children: ReactNode }) {
  const controllers = useMemo(
    () => createControllers(createStoreWriter(lexStore)),
    []
  );
  return (
    <Provider store={lexStore}>
      <ControllersContext.Provider value={controllers}>
        {children}
      </ControllersContext.Provider>
    </Provider>
  );
}

export function useLexControllers(): LexControllers {
  const ctx = useContext(ControllersContext);
  if (!ctx)
    throw new Error("useLexControllers must be used within LexStoreProvider");
  return ctx;
}
