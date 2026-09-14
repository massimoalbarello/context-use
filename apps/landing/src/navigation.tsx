import { MarkGithubIcon } from '@primer/octicons-react';
import { Button, buttonVariants } from '@repo/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/popover';
import { ArrowUpRight, Menu, X } from 'lucide-react';

const GITHUB_URL = 'https://github.com/massimoalbarello/context-use';
const DEMO_URL = 'https://demo.context-use.com/map';
const DEPLOY_URL =
  'https://app.nibrun.com/deploy?name=context-use&binary=https%3A%2F%2Fgithub.com%2Fmassimoalbarello%2Fcontext-use%2Freleases%2Fdownload%2Fnibrun-latest%2Fcontext-use&port=3000&minimal';

function NavigationLinks() {
  return (
    <>
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
      <a href={DEPLOY_URL} className={buttonVariants({ size: 'lg' })}>
        Deploy your own
        <ArrowUpRight aria-hidden="true" />
      </a>
    </>
  );
}

export function LandingNavigation() {
  return (
    <>
      <nav aria-label="Main navigation" className="hidden items-center gap-3 sm:flex">
        <NavigationLinks />
      </nav>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              className="group sm:hidden"
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
          className="w-56 max-w-[calc(100vw-2.5rem)] p-2 sm:hidden"
        >
          <nav aria-label="Mobile navigation" className="flex flex-col gap-1">
            <NavigationLinks />
          </nav>
        </PopoverContent>
      </Popover>
    </>
  );
}
