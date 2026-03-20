import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function resolveEnvValue(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmedValue = value.trim();

      if (trimmedValue) {
        return trimmedValue;
      }
    }
  }

  return "";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = resolveEnvValue(
    process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_URL,
    env.SUPABASE_URL,
    env.VITE_SUPABASE_URL,
  );
  const supabasePublishableKey = resolveEnvValue(
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    env.SUPABASE_PUBLISHABLE_KEY,
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );

  return {
    plugins: [react()],
    define: {
      __SUPABASE_URL__: JSON.stringify(supabaseUrl),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabasePublishableKey),
    },
  };
});
