import { fileURLToPath } from 'node:url';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-logo-poc', import.meta.url)),
  plugins: [wgslVitePlugin(), react()],
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
  build: { outDir: 'dist' },
});
