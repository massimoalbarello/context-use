import type { ReactNode } from 'react';
import { Eyebrow } from '../layout/eyebrow';

export function ResourceDetailHeading({
  children,
  actions,
  context,
}: {
  children: ReactNode;
  actions: ReactNode;
  context?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Eyebrow>{children}</Eyebrow>
        {context}
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">{actions}</div>
    </div>
  );
}
