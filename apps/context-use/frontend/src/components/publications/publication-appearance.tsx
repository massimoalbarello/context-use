import { type Button, buttonVariants } from '@repo/ui/button';
import type { ComponentProps } from 'react';
import { Badge } from '../ui/badge';

const publicActionClassName =
  'bg-public text-public-foreground hover:bg-public-foreground/15 hover:text-public-foreground focus-visible:border-public-foreground/40 focus-visible:ring-public-foreground/20 dark:hover:bg-public-foreground/15';

export function PublicBadge() {
  return (
    <Badge variant="secondary" className="bg-public text-public-foreground">
      Public
    </Badge>
  );
}

export function UnpublishedRevisionsBadge() {
  return (
    <Badge variant="secondary" className="bg-warning text-warning-foreground">
      Unpublished revisions
    </Badge>
  );
}

export function ViewPublicLink({
  href,
  size = 'lg',
  children = 'View public',
}: {
  href: string;
  size?: ComponentProps<typeof Button>['size'];
  children?: string;
}) {
  return (
    <a
      className={buttonVariants({ variant: 'ghost', size, className: publicActionClassName })}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}
