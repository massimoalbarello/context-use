import { ArrowUpRight } from 'lucide-react';
import { AnimatedContextUseLogo } from '../src/components/brand/animated-context-use-logo';
import { ContextUseLogo } from '../src/components/brand/context-use-logo';
import { buttonVariants } from '../src/components/ui/button';

const GITHUB_URL = 'https://github.com/massimoalbarello/context-use';
const DEMO_URL = 'https://steve-jobs-demo-fye81b.nibrun.app/hypermedia';
const DEPLOY_URL =
  'https://app.nibrun.com/deploy?name=context-use&binary=https%3A%2F%2Fgithub.com%2Fmassimoalbarello%2Fcontext-use%2Freleases%2Fdownload%2Fnibrun-latest%2Fcontext-use&port=3000&minimal';

export function LandingPage() {
  return (
    <div className="relative isolate min-h-dvh bg-[#050608] font-sans text-foreground">
      <main className="fixed inset-0 -z-10">
        <h1 className="sr-only">Context Use — Personal hypermedia for human-agent collaboration</h1>
        <AnimatedContextUseLogo className="aspect-auto size-full" />
      </main>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-5 sm:px-8 sm:py-6">
        <a
          href="/"
          className="inline-flex items-center gap-2.5 rounded-sm font-medium text-base tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ContextUseLogo className="size-6" />
          context-use
        </a>
        <nav
          aria-label="Main navigation"
          className="flex items-center gap-1 max-sm:w-full max-sm:justify-between sm:gap-3 max-sm:[&_a]:px-2 max-sm:[&_a]:text-xs"
        >
          <a href={GITHUB_URL} className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
            GitHub
          </a>
          <a href={DEMO_URL} className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
            Steve Jobs demo
          </a>
          <a href={DEPLOY_URL} className={buttonVariants({ size: 'lg' })}>
            <span>
              Deploy<span className="max-sm:sr-only"> your own</span>
            </span>
            <ArrowUpRight aria-hidden="true" />
          </a>
        </nav>
      </header>
    </div>
  );
}
