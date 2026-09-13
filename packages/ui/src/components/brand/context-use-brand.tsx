import { cn } from '../../lib/class-names';
import { ContextUseLogo } from './context-use-logo';

export function ContextUseBrand({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center justify-center gap-2.5 whitespace-nowrap font-semibold text-base tracking-tight',
        className,
      )}
    >
      <ContextUseLogo className="size-[1.5em]" />
      <span className="truncate">Context Use</span>
    </span>
  );
}
