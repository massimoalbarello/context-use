import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import dashboard from '../frontend/vite.config';
import { demoNotice } from './frontend/notice';

export default mergeConfig(
  dashboard,
  defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    build: {
      outDir: fileURLToPath(new URL('../dist/demo/public', import.meta.url)),
      emptyOutDir: true,
    },
    plugins: [demoNotice()],
    resolve: {
      alias: [
        {
          find: /^(?:.*\/lib\/|\.\/)calendar-now(?:\.ts)?$/,
          replacement: fileURLToPath(new URL('./frontend/calendar-now.ts', import.meta.url)),
        },
      ],
    },
  }),
);
