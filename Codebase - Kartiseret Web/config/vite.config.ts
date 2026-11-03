import { defineConfig, loadEnv } from "vite";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const configDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(configDir, "..");
const repoRoot = resolve(appRoot, "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const apiProxyTarget =
    process.env.VITE_API_PROXY_TARGET ?? env.VITE_API_PROXY_TARGET ?? "";

  return {
    envDir: repoRoot,
    plugins: [react()],
    build: {
      // Public pages share one CSS file so route-chunk styles are present in
      // the HTML before client JavaScript loads.
      cssCodeSplit: false,
    },
    server: apiProxyTarget
      ? {
          proxy: {
            "/api": {
              target: apiProxyTarget,
              changeOrigin: true,
            },
          },
        }
      : undefined,
  };
});
