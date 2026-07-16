import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/mcp": "http://localhost:3000",
      "/p": "http://localhost:3000",
      "/.well-known": "http://localhost:3000",
      "/public.css": "http://localhost:3000",
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
