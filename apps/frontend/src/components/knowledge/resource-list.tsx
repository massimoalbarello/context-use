import { cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export const resourceCardVariants = cva(
  'flex h-20 min-w-0 items-center gap-3 rounded-xl border border-transparent bg-transparent p-3 text-left transition-[background-color,border-color,box-shadow] hover:bg-card hover:shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-selected:border-foreground/35 aria-selected:bg-card aria-selected:shadow-sm data-[route-selected=true]:border-foreground/35 data-[route-selected=true]:bg-card data-[route-selected=true]:shadow-sm',
);

export function ResourceList({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cn('grid list-none gap-3 p-0 [&>li]:min-w-0', className)} {...props} />;
}

export function ResourceListEmpty({ title, children }: { title: string; children: string }) {
  return (
    <div className="rounded-xl bg-muted p-7 text-center">
      <p className="font-medium">{title}</p>
      <span className="mt-1 block text-muted-foreground text-sm">{children}</span>
    </div>
  );
}
