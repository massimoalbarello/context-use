import { AnimatedContextUseLogo } from '@repo/ui/animated-context-use-logo';
import { ContextUseBrand } from '@repo/ui/context-use-brand';
import { ChevronDown } from 'lucide-react';
import { HowItWorks } from './how-it-works';
import { LandingNavigation } from './navigation';

export function LandingPage() {
  return (
    <div className="relative isolate min-h-dvh bg-[#050608] font-sans text-foreground">
      <main>
        <div className="landing-hero">
          <h1 className="sr-only">
            Context Use — Personal hypermedia for human-agent collaboration
          </h1>
          <AnimatedContextUseLogo className="absolute inset-0 aspect-auto size-full" />
          <header className="relative flex items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6">
            <ContextUseBrand />
            <LandingNavigation />
          </header>
          <a
            href="#how-it-works"
            className="landing-scroll-cue"
            aria-label="Scroll to how Context Use works"
          >
            <ChevronDown aria-hidden="true" size={22} strokeWidth={1.5} />
          </a>
        </div>
        <HowItWorks />
      </main>
    </div>
  );
}
