import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";
const publicMcpProxyTarget = process.env.VITE_PUBLIC_MCP_PROXY_TARGET ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/public/mcp": publicMcpProxyTarget,
      "/api": apiProxyTarget,
      "/mcp": apiProxyTarget,
      "/p": apiProxyTarget,
      "/.well-known": apiProxyTarget,
      "/public.css": apiProxyTarget,
      "/content.css": apiProxyTarget,
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
