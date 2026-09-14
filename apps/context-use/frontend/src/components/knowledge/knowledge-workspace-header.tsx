import { cn } from '@repo/ui/class-names';
import type { ReactNode } from 'react';

export function KnowledgeWorkspaceHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <header className="shrink-0 border-b px-3 py-4.5 sm:px-5 md:px-8">
      <div className={cn('flex min-h-10 items-center gap-2 max-[360px]:gap-1 md:gap-4', className)}>
        {children}
      </div>
    </header>
  );
}
