import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
import { useKnowledgeWorkspace } from './knowledge-workspace';

export function DetailShell({ className, ...props }: ComponentProps<'div'>) {
  const { collapsed } = useKnowledgeWorkspace();
  return (
    <div
      className={cn(
        'mx-auto grid w-full max-w-6xl gap-7 px-5 py-7 md:px-9 md:pt-13 md:pb-9 lg:px-12',
        collapsed && 'pt-20 md:pt-9',
        className,
      )}
      {...props}
    />
  );
}

export function DetailHeader({ className, ...props }: ComponentProps<'header'>) {
  return <header className={cn('grid gap-4', className)} {...props} />;
}
