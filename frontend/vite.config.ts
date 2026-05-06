import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      // Disable in dev — service workers + Vite HMR don't mix gracefully and
      // we want field testing to use the actual production-built worker.
      devOptions: { enabled: false },
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "FlowOps",
        short_name: "FlowOps",
        description: "Asset & work management for water utilities",
        theme_color: "#0f172a",
        background_color: "#f8fafc",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icon-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
          {
            src: "/icon-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Don't precache MapLibre worker chunks — they're huge and only the
        // /map route needs them; let runtime caching handle on-demand.
        globIgnores: ["**/maplibre-*.js"],
        // Read-only catalog endpoints rarely change — fast offline reads.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname === "/api/v1/auth/me" ||
              url.pathname === "/api/v1/asset-classes" ||
              url.pathname === "/api/v1/tile-layers" ||
              url.pathname === "/api/v1/pacp-codes" ||
              url.pathname === "/api/v1/reports",
            handler: "StaleWhileRevalidate",
            method: "GET",
            options: {
              cacheName: "flowops-readonly-v1",
              expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
          // Live data — try network first, fall back to last cached response.
          // The mutation queue + custom IDB asset cache cover deeper offline
          // reads; this just keeps the last response usable on flaky links.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/v1/assets") ||
              url.pathname.startsWith("/api/v1/work-orders") ||
              url.pathname.startsWith("/api/v1/inspections") ||
              url.pathname.startsWith("/api/v1/service-requests"),
            handler: "NetworkFirst",
            method: "GET",
            options: {
              cacheName: "flowops-live-v1",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 },
            },
          },
        ],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/tiles\//, /^\/healthz/],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5000",
      "/healthz": "http://127.0.0.1:5000",
    },
  },
});
