import dashboard from '@repo/frontend/vite';
import { defineConfig, mergeConfig } from 'vite';

export default mergeConfig(dashboard, defineConfig({ build: { outDir: 'dist/public' } }));
