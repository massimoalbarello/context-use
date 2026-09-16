import { buttonVariants } from '@repo/ui/button';
import { CONTEXT_USE_DEPLOY_URL } from '@repo/ui/context-use-links';
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
        `,
        injectTo: 'head',
      },
      {
        tag: 'aside',
        attrs: {
          id: 'demo-notice',
          class:
            'demo-surface flex flex-col items-start justify-between gap-3 border-b border-border bg-background px-4 py-3 text-foreground sm:flex-row sm:items-center sm:gap-6 sm:px-6',
          'aria-label': 'Read-only demo',
        },
        children: `
          <div class="min-w-0 flex-1 text-sm">
            <p class="text-xs text-muted-foreground">Steve Jobs’ fictional context, 2001–2007 · Invented conversations and notes · Read-only demo</p>
            <p class="mt-1 max-md:hidden">Deploy your own instance, connect your agents via MCP and start curating your own context.</p>
          </div>
          <div class="max-md:hidden">
            <a href="${CONTEXT_USE_DEPLOY_URL.replaceAll('&', '&amp;')}" target="_blank" rel="noopener noreferrer" class="${buttonVariants({ className: 'sm:self-center' })}">
              Deploy your own <span aria-hidden="true">↗</span>
              <span class="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        `,
        injectTo: 'body-prepend',
      },
    ],
  };
}
