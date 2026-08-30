import type { ReactNode } from 'react';
import { Eyebrow } from '../layout/eyebrow';

export function ResourceDetailHeading({
  children,
  actions,
}: {
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-col items-start justify-between gap-3 md:flex-row md:items-center">
      <Eyebrow>{children}</Eyebrow>
      <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
    </div>
  );
}
