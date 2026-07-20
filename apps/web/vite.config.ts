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
      "/a": apiProxyTarget,
      "/.well-known": apiProxyTarget,
      "/public.css": apiProxyTarget,
      "/content.css": apiProxyTarget,
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
