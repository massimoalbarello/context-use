import { cn } from '@repo/ui/class-names';
import type { ComponentProps } from 'react';

export function Eyebrow({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'flex min-h-5 w-fit items-center gap-2 font-semibold text-foreground text-xs uppercase tracking-[0.16em]',
        className,
      )}
      {...props}
    />
  );
}
