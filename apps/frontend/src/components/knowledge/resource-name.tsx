import type { ComponentProps } from 'react';
import { cn } from '../../lib/class-names';
import { Input } from '../ui/input';

export function ResourceName({ className, ...props }: ComponentProps<'h1'>) {
  return (
    <h1
      className={cn('mt-2 max-w-3xl font-semibold text-4xl tracking-tight md:text-5xl', className)}
      {...props}
    />
  );
}

export function ResourceNameInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        '-mx-2 mt-2 h-auto w-[calc(100%+1rem)] px-2 py-0 font-semibold text-4xl text-foreground tracking-tight md:text-5xl',
        className,
      )}
      {...props}
    />
  );
}
