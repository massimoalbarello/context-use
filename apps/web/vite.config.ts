import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiProxyTarget,
      "/mcp": apiProxyTarget,
      "/p": apiProxyTarget,
      // Keep the public asset route from also matching the dashboard's /app path.
      "/a/": apiProxyTarget,
      "/llms.txt": apiProxyTarget,
      "/llms-full.txt": apiProxyTarget,
      "/.well-known": apiProxyTarget,
      "/public.css": apiProxyTarget,
      "/content.css": apiProxyTarget,
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
