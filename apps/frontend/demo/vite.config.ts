import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import applicationConfig from '../vite.config';
import { demoNotice } from './notice';

// This explicit build owns the replacements. No environment variable can activate them
// in the personal frontend, and its output never overwrites the personal build's dist.
export default mergeConfig(
  applicationConfig,
  defineConfig({
    build: { outDir: 'demo/dist' },
    plugins: [demoNotice()],
    resolve: {
      alias: [
        {
          find: '/src/main.tsx',
          replacement: fileURLToPath(new URL('./main.tsx', import.meta.url)),
        },
        {
          find: /^(?:.*\/lib\/|\.\/)calendar-now(?:\.ts)?$/,
          replacement: fileURLToPath(new URL('./calendar-now.ts', import.meta.url)),
        },
      ],
    },
  }),
);
