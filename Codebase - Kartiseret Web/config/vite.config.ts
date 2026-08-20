import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOptionalSupabaseConfig } from "../src/lib/supabaseConfig.js";

const configDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(configDir, "..");
const repoRoot = resolve(appRoot, "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const supabaseConfig = resolveOptionalSupabaseConfig(
    [
      process.env.SUPABASE_URL,
      process.env.VITE_SUPABASE_URL,
      env.SUPABASE_URL,
      env.VITE_SUPABASE_URL,
    ],
    [
      process.env.SUPABASE_PUBLISHABLE_KEY,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      env.SUPABASE_PUBLISHABLE_KEY,
      env.VITE_SUPABASE_PUBLISHABLE_KEY,
    ],
  );
  const supabaseOrigin = supabaseConfig
    ? new URL(supabaseConfig.url).origin
    : "";

  return {
    envDir: repoRoot,
    plugins: [
      react(),
      {
        name: "inject-supabase-resource-hints",
        transformIndexHtml(html) {
          if (!supabaseOrigin) {
            return html;
          }

          return {
            html,
            tags: [
              {
                tag: "link",
                attrs: {
                  rel: "preconnect",
                  href: supabaseOrigin,
                  crossorigin: "",
                },
                injectTo: "head",
              },
              {
                tag: "link",
                attrs: {
                  rel: "dns-prefetch",
                  href: supabaseOrigin,
                },
                injectTo: "head",
              },
            ],
          };
        },
      },
    ],
    define: {
      __SUPABASE_URL__: JSON.stringify(supabaseConfig?.url ?? ""),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(
        supabaseConfig?.publishableKey ?? "",
      ),
    },
  };
});
