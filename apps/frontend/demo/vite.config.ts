import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import applicationConfig from '../vite.config';

// This explicit build owns the replacements. No environment variable can activate them
// in the personal frontend, and its output never overwrites the personal build's dist.
export default mergeConfig(
  applicationConfig,
  defineConfig({
    build: { outDir: 'demo/dist' },
    resolve: {
      alias: [
        {
          find: /^(?:.*\/lib\/|\.\/)workspace-access(?:\.ts)?$/,
          replacement: fileURLToPath(new URL('./workspace-access.ts', import.meta.url)),
        },
        {
          find: /^(?:.*\/lib\/|\.\/)calendar-now(?:\.ts)?$/,
          replacement: fileURLToPath(new URL('./calendar-now.ts', import.meta.url)),
        },
      ],
    },
  }),
);
