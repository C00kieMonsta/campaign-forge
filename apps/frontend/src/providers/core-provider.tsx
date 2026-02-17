/**
 * Core Provider
 *
 * Single wrapper that bundles all core infrastructure:
 * - TanStack Query for data fetching and caching
 * - Redux store for global state management
 * - PersistenceServiceProvider for repository access
 * - WebSocket service for realtime updates
 *
 * Every app mounts one CoreProvider instead of wiring a full provider tree.
 *
 * Requirements: 1.1, 9.1, 9.2, 12.1, 12.2
 */

import { useEffect, useRef, useState } from "react";
import {
  createAppStore,
  HttpDatabaseAdapter,
  PersistenceServiceProvider,
  RealtimeWebSocketService,
  useAppDataOrchestrator
} from "@packages/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { AuthProvider } from "@/contexts/auth-context";
import { getCacheManager } from "@/lib/cache-manager";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface CoreProviderProps {
  children: React.ReactNode;
}

/**
 * Get the backend API base URL from environment variables
 */
function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || "";
}

/**
 * Get the WebSocket URL from environment variables
 */
function getWebSocketUrl(): string {
  const wsUrl = import.meta.env.VITE_WS_URL;
  if (wsUrl) {
    return wsUrl;
  }

  const apiUrl = import.meta.env.VITE_API_URL || "";
  if (apiUrl) {
    return apiUrl.replace(/^http/, "ws") + "/ws";
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }

  return "";
}

/**
 * Create a configured QueryClient instance
 */
function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        retry: 2,
        retryDelay: (attemptIndex) =>
          Math.min(1000 * 2 ** attemptIndex, 30_000),
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        placeholderData: (previousData: unknown) => previousData
      },
      mutations: {
        retry: 1,
        networkMode: "online"
      }
    }
  });

  getCacheManager(client);
  return client;
}

/**
 * Initialize app data (clients, projects, hot data subscriptions)
 * This component is rendered after PersistenceServiceProvider is initialized
 *
 * Uses consolidated orchestrator that manages all data initialization
 * with proper sequencing and Layer 1 defenses
 */
function InitializeAppData() {
  useAppDataOrchestrator();
  return null;
}

/**
 * CoreProvider Component
 *
 * Single entry point for all core infrastructure:
 * 1. TanStack Query for data fetching/caching
 * 2. Redux store for global state
 * 3. HttpDatabaseAdapter for API communication with Supabase auth
 * 4. RealtimeWebSocketService for realtime updates
 * 5. PersistenceServiceProvider singleton for repository access
 */
export function CoreProvider({ children }: CoreProviderProps) {
  // Create QueryClient instance once
  const [queryClient] = useState(() => createQueryClient());

  // Create Redux store instance once
  const storeRef = useRef(createAppStore());

  // Track initialization state
  const [initialized, setInitialized] = useState(false);
  const initializationRef = useRef(false);

  useEffect(() => {
    console.log("[CoreProvider] useEffect triggered");

    // Prevent double initialization in React StrictMode
    if (initializationRef.current) {
      console.log("[CoreProvider] Already initialized");
      return;
    }
    initializationRef.current = true;

    // Initialize PersistenceServiceProvider
    const initializeProvider = async () => {
      try {
        console.log(
          "[CoreProvider] Starting PersistenceServiceProvider initialization"
        );

        if (PersistenceServiceProvider.isInitialized()) {
          console.log(
            "[CoreProvider] PersistenceServiceProvider already initialized"
          );
          setInitialized(true);
          return;
        }

        const adapter = new HttpDatabaseAdapter({
          baseUrl: getApiBaseUrl(),
          getAuthToken: async () => {
            const supabase = getSupabaseBrowser();
            const {
              data: { session }
            } = await supabase.auth.getSession();
            return session?.access_token || null;
          }
        });
        console.log("[CoreProvider] HttpDatabaseAdapter created");

        const wsService = new RealtimeWebSocketService({
          debug: import.meta.env.DEV
        });
        console.log("[CoreProvider] RealtimeWebSocketService created");

        const wsUrl = getWebSocketUrl();
        if (wsUrl) {
          try {
            console.log("[CoreProvider] Connecting WebSocket to:", wsUrl);
            await wsService.connect(wsUrl);
            console.log("[CoreProvider] WebSocket connected");
          } catch (error) {
            console.warn("[CoreProvider] Failed to connect WebSocket:", error);
          }
        }

        console.log("[CoreProvider] Initializing PersistenceServiceProvider");
        PersistenceServiceProvider.initialize({
          store: storeRef.current,
          adapter,
          wsService,
          queryClient
        });
        console.log(
          "[CoreProvider] PersistenceServiceProvider initialized successfully"
        );
        setInitialized(true);
      } catch {
        setInitialized(true); // Still set to true to avoid infinite loop
      }
    };

    initializeProvider();
  }, [queryClient]);

  // Show loading state while initializing
  if (!initialized) {
    console.log("[CoreProvider] Not yet initialized, showing placeholder");
    return (
      <QueryClientProvider client={queryClient}>
        <Provider store={storeRef.current}>
          <AuthProvider>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100vh"
              }}
            >
              <p>Initializing...</p>
            </div>
          </AuthProvider>
        </Provider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Provider store={storeRef.current}>
        <AuthProvider>
          <InitializeAppData />
          {children}
        </AuthProvider>
      </Provider>
    </QueryClientProvider>
  );
}
