import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-landing', import.meta.url)),
  plugins: [wgslVitePlugin(), tailwindcss(), react()],
  server: { host: '127.0.0.1' },
  build: { outDir: 'dist/public' },
});
