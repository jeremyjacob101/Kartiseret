import { defineConfig, loadEnv, type ViteDevServer } from "vite";
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
  const publicRouteRedirectPlugin = apiProxyTarget
    ? {
        name: "opaque-public-route-dev-redirects",
        configureServer(server: ViteDevServer) {
          // Vercel rewrites legacy human-facing paths through the server route
          // registry, which redirects them to their opaque code. Mirror that
          // behavior in local browser runs by sending document navigations to
          // the same API resolver before Vite's SPA fallback handles them.
          server.middlewares.use((request, _response, next) => {
            if (
              request.method !== "GET" ||
              !request.headers.accept?.includes("text/html")
            ) {
              next();
              return;
            }

            const url = new URL(request.url ?? "/", "http://localhost");
            const pathname = url.pathname;
            const isOpaqueRouteCode = /^\/[a-z0-9]{8}$/.test(pathname);
            const isSecureEmailAction =
              /^\/(?:e[A-Za-z0-9._-]{24,4094}|[rd][A-Za-z0-9_-]{16,256}|u[A-Za-z0-9_-]{43})$/.test(
                pathname,
              );
            if (
              pathname.startsWith("/api/") ||
              pathname.startsWith("/assets/") ||
              pathname.startsWith("/.well-known/") ||
              isOpaqueRouteCode ||
              isSecureEmailAction ||
              pathname === "/confirm-account-deletion" ||
              pathname === "/unsubscribe/letterboxd"
            ) {
              next();
              return;
            }

            const legacyPath = `${url.pathname}${url.search}`;
            request.url = `/api/v1/public-routes/legacy/open?path=${encodeURIComponent(legacyPath)}`;
            next();
          });
        },
      }
    : null;

  return {
    envDir: repoRoot,
    plugins: [
      react(),
      ...(publicRouteRedirectPlugin ? [publicRouteRedirectPlugin] : []),
    ],
    build: {
      license: { fileName: "third-party-licenses.txt" },
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
