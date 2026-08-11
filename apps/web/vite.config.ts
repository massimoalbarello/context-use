import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

// The services behind this proxy check that a request's Host still matches the
// browser-facing APP_ORIGIN, so the development proxy has to forward the original Host
// rather than rewriting it to the internal target. Rewriting it makes every guarded
// dashboard route answer 404 `security_error` in local development.
const forwarded = { target: apiProxyTarget, changeOrigin: false };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": forwarded,
      "/mcp": forwarded,
      "/p": forwarded,
      // Keep the public asset route from also matching the dashboard's /app path.
      "/a/": forwarded,
      "/llms.txt": forwarded,
      "/llms-full.txt": forwarded,
      "/robots.txt": forwarded,
      "/sitemap.xml": forwarded,
      "/.well-known": forwarded,
      "/public.css": forwarded,
      "/content.css": forwarded,
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
