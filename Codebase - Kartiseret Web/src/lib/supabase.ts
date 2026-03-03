import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;

function requireConfig(name: string, value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error(`Missing required ${name} environment variable.`);
  }

  return trimmedValue;
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  // The browser app must only use the public anon key. The service role key
  // is intentionally not exposed here.
  const supabaseUrl = requireConfig("SUPABASE_URL", __SUPABASE_URL__);
  const supabaseAnonKey = requireConfig(
    "SUPABASE_ANON_KEY",
    __SUPABASE_ANON_KEY__,
  );

  supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClient;
}
