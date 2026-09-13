import { cn } from '../../lib/class-names';
import { ContextUseLogo } from './context-use-logo';

export function ContextUseBrand({ className }: { className?: string }) {
  return (
    <a
      href="https://context-use.com"
      className={cn(
        'inline-flex min-w-0 items-center justify-center gap-2.5 whitespace-nowrap rounded-sm font-semibold text-base tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <ContextUseLogo className="size-[1.5em]" />
      <span className="truncate">Context Use</span>
    </a>
  );
}
