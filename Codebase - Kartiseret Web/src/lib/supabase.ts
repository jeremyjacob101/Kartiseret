import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "./supabaseConfig.js";

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  // The browser app must only use a public key (publishable/anon). The service
  // role key is intentionally not exposed here.
  const config = requireSupabaseConfig(
    [import.meta.env.VITE_SUPABASE_URL, __SUPABASE_URL__],
    [
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      __SUPABASE_PUBLISHABLE_KEY__,
    ],
    "browser Supabase configuration",
  );

  supabaseClient = createClient(config.url, config.publishableKey);

  return supabaseClient;
}
