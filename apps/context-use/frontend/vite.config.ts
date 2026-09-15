import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';
import react from '@vitejs/plugin-react';
import { defineConfig, normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from '#backend/lib/runtime-config.ts';

const require = createRequire(import.meta.url);
const pdfjsDirectory = dirname(
  createRequire(require.resolve('react-pdf/package.json')).resolve('pdfjs-dist/package.json'),
);

const BACKEND_ORIGIN = `http://localhost:${DEFAULT_BACKEND_PORT}`;
const MCP_TRANSPORT_PROXY_CONTEXT = '^/mcp/?(?:\\?.*)?$';
const MCP_ASSET_TRANSFERS_PROXY_CONTEXT = '^/mcp/asset-transfers(?:/|\\?|$)';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('../dist/instance/public', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: DEFAULT_FRONTEND_PORT,
    strictPort: true,
    // Vite is the public origin in development. Better Auth's BASE_URL points here, so preserve
    // the browser's Origin header while proxying instead of pretending it came from the backend.
    proxy: {
      '/api': { target: BACKEND_ORIGIN },
      // Vite treats keys beginning with ^ as regular expressions. Keep the frontend-owned
      // /mcp/authorize route out of the proxy while preserving the transport (with query strings
      // or a trailing slash) and the separate asset-transfer endpoints.
      [MCP_TRANSPORT_PROXY_CONTEXT]: { target: BACKEND_ORIGIN },
      [MCP_ASSET_TRANSFERS_PROXY_CONTEXT]: { target: BACKEND_ORIGIN },
      '/.well-known': { target: BACKEND_ORIGIN },
      // The docs page and the spec it fetches are served by the backend, so the dev server
      // has to hand both over rather than answering with the SPA.
      '/openapi': { target: BACKEND_ORIGIN },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: normalizePath(join(pdfjsDirectory, 'build/pdf.worker.min.mjs')),
          dest: 'pdfjs',
          rename: { stripBase: true },
        },
        ...['cmaps', 'standard_fonts', 'wasm'].map((folder) => ({
          src: normalizePath(join(pdfjsDirectory, folder)),
          dest: `pdfjs/${folder}`,
          rename: { stripBase: true as const },
        })),
      ],
    }),
    wgslVitePlugin(),
    tailwindcss(),
    tanstackRouter({
      target: 'react',
      routesDirectory: fileURLToPath(new URL('./src/routes', import.meta.url)),
      generatedRouteTree: fileURLToPath(new URL('./src/routeTree.gen.ts', import.meta.url)),
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
