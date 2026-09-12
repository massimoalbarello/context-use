import type { Plugin } from 'vite';

/** Build-only chrome outside React: the personal app and its controls stay unchanged. */
export function demoNotice(): Plugin {
  return {
    name: 'public-demo-notice',
    transformIndexHtml: () => [
      {
        tag: 'style',
        children: `
          body { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100dvh; }
          #app { min-height: 0; }
          #app > div { height: 100%; }
          #demo-notice {
            padding: 0.625rem 1rem; border-bottom: 1px solid var(--border);
            background: var(--muted); color: var(--foreground);
            font-size: 0.8125rem; line-height: 1.5; text-align: center;
          }
        `,
        injectTo: 'head',
      },
      {
        tag: 'aside',
        attrs: { id: 'demo-notice', 'aria-label': 'Read-only demo' },
        children:
          '<strong>Read-only demo</strong> · Explore Steve Jobs’ context, 2001–2007. Changes and account actions cannot be saved.',
        injectTo: 'body-prepend',
      },
    ],
  };
}
