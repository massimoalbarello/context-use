import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from '@repo/backend/runtime-config';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const BACKEND_ORIGIN = `http://localhost:${DEFAULT_BACKEND_PORT}`;

export default defineConfig({
  server: {
    port: DEFAULT_FRONTEND_PORT,
    strictPort: true,
    // Vite is the public origin in development. Better Auth's BASE_URL points here, so preserve
    // the browser's Origin header while proxying instead of pretending it came from the backend.
    proxy: {
      '/api': { target: BACKEND_ORIGIN },
      // The docs page and the spec it fetches are served by the backend, so the dev server
      // has to hand both over rather than answering with the SPA.
      '/openapi': { target: BACKEND_ORIGIN },
    },
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
