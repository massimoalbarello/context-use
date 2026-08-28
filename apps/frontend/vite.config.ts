import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const BACKEND_ORIGIN = 'http://localhost:3000';

export default defineConfig({
  server: {
    // Vite is the public origin in development. Better Auth's BASE_URL points here, so preserve
    // the browser's Origin header while proxying instead of pretending the request came from :3000.
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
