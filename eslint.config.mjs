import { plugin as shadcn } from '@shadcn/lint';
import query from '@tanstack/eslint-plugin-query';
import tsParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    files: ['apps/context-use/frontend/src/**/*.{ts,tsx}'],
    ignores: ['**/*.gen.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { shadcn, '@tanstack/query': query },
    settings: {
      shadcn: {
        componentImports: ['^@repo/ui/', '(^|/)components/ui/', '^\\.\\./ui/'],
      },
    },
    rules: {
      // SVG's fill-none is valid, but shadcn/lint 0.1 mistakes it for a color token.
      'shadcn/no-raw-colors': ['error', { allow: ['fill-none'] }],
      'shadcn/no-unknown-classes': 'error',
      // Advisory while existing specialized buttons retain their visual contracts.
      'shadcn/no-restyle': [
        'warn',
        {
          deny: [],
          contracts: [
            {
              pattern: '^Button$',
              deny: ['color', 'shape'],
              message:
                'Prefer a {{component}} variant ({{variants}}) from {{file}} for colors and shape. Keep layout in className.',
            },
          ],
        },
      ],
      '@tanstack/query/exhaustive-deps': 'error',
      '@tanstack/query/stable-query-client': 'error',
    },
  },
  {
    files: ['apps/context-use/frontend/src/components/ui/**'],
    rules: { 'shadcn/no-restyle': 'off' },
  },
]);
