import { AnimatedContextUseLogo } from '@repo/ui/animated-context-use-logo';
import { ContextUseLogo } from '@repo/ui/context-use-logo';
import { LandingNavigation } from './navigation';

export function LandingPage() {
  return (
    <div className="relative isolate min-h-dvh bg-[#050608] font-sans text-foreground">
      <main className="fixed inset-0 -z-10">
        <h1 className="sr-only">Context Use — Personal hypermedia for human-agent collaboration</h1>
        <AnimatedContextUseLogo className="aspect-auto size-full" />
      </main>
      <header className="flex items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6">
        <a
          href="/"
          className="inline-flex items-center gap-2.5 rounded-sm font-medium text-base tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ContextUseLogo className="size-6" />
          context-use
        </a>
        <LandingNavigation />
      </header>
    </div>
  );
}
