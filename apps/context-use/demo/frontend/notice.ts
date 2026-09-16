import { buttonVariants } from '@repo/ui/button';
import { CONTEXT_USE_DEPLOY_URL } from '@repo/ui/context-use-links';
import type { Plugin } from 'vite';

/** Demo-only chrome around the shared personal app, with a slot for the welcome dialog trigger. */
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
            'demo-surface flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-3 text-foreground sm:gap-6 sm:px-6',
          'aria-label': 'Read-only demo',
        },
        children: `
          <div class="min-w-0 flex-1 text-sm">
            <p class="text-xs text-muted-foreground">Steve Jobs’ fictional context, 2001–2007 · Invented conversations and notes · Read-only demo</p>
            <p class="mt-1 max-md:hidden">Deploy your own instance, connect your agents via MCP and start curating your own context.</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <div id="demo-introduction-trigger"></div>
            <div class="max-md:hidden">
              <a href="${CONTEXT_USE_DEPLOY_URL.replaceAll('&', '&amp;')}" target="_blank" rel="noopener noreferrer" class="${buttonVariants()}">
                Deploy your own <span aria-hidden="true">↗</span>
                <span class="sr-only">(opens in a new tab)</span>
              </a>
            </div>
          </div>
        `,
        injectTo: 'body-prepend',
      },
    ],
  };
}
