import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { webEnv } from "./env";

let client: SupabaseClient | null = null;

// Service-role client: bypasses RLS, so it must only ever be imported from
// route handlers and server components (everything under lib/server).
export function db(): SupabaseClient {
  if (!client) {
    const env = webEnv();
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
