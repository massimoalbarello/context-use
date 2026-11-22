import type { ReactNode } from 'react';
import { ResourceName } from '../knowledge/resource-name';
export function EntityProfile({
  entity,
  heading = <ResourceName>{entity.name}</ResourceName>,
  portrait,
}: {
  entity: { name: string; description: string };
  heading?: ReactNode;
  portrait: ReactNode;
}) {
  return (
    <div className="flex w-full min-w-0 max-w-3xl flex-col gap-5 sm:flex-row sm:items-start">
      {portrait}
      <div className="min-w-0 flex-1">
        {heading}
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground leading-relaxed">
          {entity.description}
        </p>
      </div>
    </div>
  );
}
