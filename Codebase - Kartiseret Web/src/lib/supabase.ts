import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;

function requireConfig(
  name: string,
  ...values: Array<string | undefined>
): string {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmedValue = value.trim();

    if (trimmedValue) {
      return trimmedValue;
    }
  }

  throw new Error(`Missing required ${name} environment variable.`);
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  // The browser app must only use a public key (publishable/anon). The service
  // role key is intentionally not exposed here.
  const supabaseUrl = requireConfig(
    "SUPABASE_URL",
    import.meta.env.VITE_SUPABASE_URL,
    __SUPABASE_URL__,
  );
  const supabasePublishableKey = requireConfig(
    "SUPABASE_PUBLISHABLE_DEFAULT_KEY or SUPABASE_ANON_KEY",
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    __SUPABASE_PUBLISHABLE_DEFAULT_KEY__,
    __SUPABASE_ANON_KEY__,
  );

  supabaseClient = createClient(supabaseUrl, supabasePublishableKey);

  return supabaseClient;
}
