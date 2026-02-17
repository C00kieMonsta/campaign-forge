import { createClient } from "@supabase/supabase-js";

let _client: ReturnType<typeof createClient> | null = null;

export function getSupabaseBrowser() {
  if (_client) return _client;
  _client = createClient(
    import.meta.env.VITE_SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        // unique storage key for this app to avoid collisions across tabs/tests
        storageKey: "me-auth-v1",
        autoRefreshToken: true,
        detectSessionInUrl: false
      },
      realtime: { params: { eventsPerSecond: 5 } }
    }
  );
  return _client;
}
