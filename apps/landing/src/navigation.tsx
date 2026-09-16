import { MarkGithubIcon } from '@primer/octicons-react';
import { Button, buttonVariants } from '@repo/ui/button';
import { CONTEXT_USE_DEPLOY_URL } from '@repo/ui/context-use-links';
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/popover';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { DEMO_URL, GITHUB_URL } from './links';

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {/* biome-ignore lint/a11y/useValidAnchor: This fragment link navigates; the handler only closes the mobile menu. */}
      <a
        href="#how-it-works"
        onClick={onNavigate}
        className={buttonVariants({ variant: 'ghost', size: 'lg' })}
      >
        How it works
      </a>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Star Context Use on GitHub (opens in a new tab)"
        className={buttonVariants({ variant: 'ghost', size: 'lg' })}
      >
        <MarkGithubIcon aria-hidden="true" />
        Star
      </a>
      <a
        href={DEMO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: 'ghost', size: 'lg' })}
      >
        Steve Jobs demo
        <ArrowUpRight aria-hidden="true" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <a href={CONTEXT_USE_DEPLOY_URL} className={buttonVariants({ size: 'lg' })}>
        Deploy your own
        <ArrowUpRight aria-hidden="true" />
      </a>
    </>
  );
}

export function LandingNavigation() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav aria-label="Main navigation" className="hidden items-center gap-3 lg:flex">
        <NavigationLinks />
      </nav>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              className="group lg:hidden"
              aria-label="Toggle navigation"
            />
          }
        >
          <Menu aria-hidden="true" className="group-data-popup-open:hidden" />
          <X aria-hidden="true" className="hidden group-data-popup-open:block" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label="Navigation"
          className="w-56 max-w-[calc(100vw-2.5rem)] p-2 lg:hidden"
        >
          <nav aria-label="Mobile navigation" className="flex flex-col gap-1">
            <NavigationLinks onNavigate={() => setOpen(false)} />
          </nav>
        </PopoverContent>
      </Popover>
    </>
  );
}
