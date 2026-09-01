import type { ComponentProps } from 'react';
import { cn } from '../../lib/class-names';

export function WorkspaceSplitLayout({ className, ...props }: ComponentProps<'main'>) {
  return (
    <main
      className={cn(
        'grid h-full min-h-0 overflow-hidden bg-sidebar md:grid-cols-[20rem_minmax(0,1fr)] md:grid-rows-none',
        className,
      )}
      {...props}
    />
  );
}
