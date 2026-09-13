import { fileURLToPath } from 'node:url';
import dashboard from '@repo/frontend/vite';
import { defineConfig, mergeConfig } from 'vite';
import { demoNotice } from './frontend/notice';

export default mergeConfig(
  dashboard,
  defineConfig({
    build: { outDir: 'dist/public' },
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
