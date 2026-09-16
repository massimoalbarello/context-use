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
            'demo-surface max-h-[50dvh] overflow-y-auto border-b border-border bg-background px-4 py-3 text-foreground sm:px-6',
          'aria-label': 'Read-only demo',
        },
        children: `
          <details open class="mb-3">
            <summary class="cursor-pointer rounded-sm text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">All your context, in one place.</summary>
            <div class="mt-3 max-w-3xl space-y-3 text-sm leading-relaxed">
              <p>Everything you know, your agents should know too. Context Use gives your agents a shared place to access and curate your context.</p>
              <p>Explore Steve Jobs' personal context and imagine how much more useful your agents would be if they could truly know you.</p>
            </div>
          </details>
          <div class="flex items-center justify-between gap-6">
            <div class="min-w-0 flex-1 text-sm">
              <p class="text-xs text-muted-foreground">Steve Jobs’ fictional context, 2001–2007 · Invented conversations and notes · Read-only demo</p>
              <p class="mt-1 max-md:hidden">Deploy your own instance, connect your agents via MCP and start curating your own context.</p>
            </div>
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
