import tailwindcss from '@tailwindcss/vite';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [wgslVitePlugin(), tailwindcss(), react()],
  server: { host: '127.0.0.1' },
  build: { outDir: 'dist/public' },
});
