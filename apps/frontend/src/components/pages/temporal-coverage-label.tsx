import { CalendarRange } from 'lucide-react';
import { cn } from '../../lib/class-names';
import { temporalCoverageLabel, temporalCoverageTitle } from '../../lib/temporal-coverage';

export function TemporalCoverageLabel({
  expression,
  className,
}: {
  expression: string;
  className?: string;
}) {
  const label = temporalCoverageLabel(expression);
  const title = temporalCoverageTitle(expression);
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1.5 text-muted-foreground', className)}
      title={title}
    >
      <CalendarRange className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
      <span className="sr-only">. {title}</span>
    </span>
  );
}
