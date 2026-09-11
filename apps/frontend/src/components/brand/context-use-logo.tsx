import contextUseLogoUrl from '../../assets/context-use.svg';
import { cn } from '../../lib/class-names';

export function ContextUseLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-8 shrink-0 bg-current', className)}
      style={{ mask: `url("${contextUseLogoUrl}") center / contain no-repeat` }}
    />
  );
}
