import { AnimatedContextUseLogo } from '@repo/ui/animated-context-use-logo';
import { ContextUseBrand } from '@repo/ui/context-use-brand';
import { LandingNavigation } from './navigation';

export function LandingPage() {
  return (
    <div className="relative isolate min-h-dvh bg-[#050608] font-sans text-foreground">
      <main className="fixed inset-0 -z-10">
        <h1 className="sr-only">Context Use — Personal hypermedia for human-agent collaboration</h1>
        <AnimatedContextUseLogo className="aspect-auto size-full" />
      </main>
      <header className="flex items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6">
        <ContextUseBrand />
        <LandingNavigation />
      </header>
    </div>
  );
}
