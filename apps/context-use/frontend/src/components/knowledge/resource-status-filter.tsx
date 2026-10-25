import { useId } from 'react';
import {
  RESOURCE_STATUSES,
  type ResourceStatus,
} from '#backend/models/resource-archiving/model.ts';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

export function ResourceStatusFilter({
  value,
  onChange,
}: {
  value?: ResourceStatus;
  onChange: (value?: ResourceStatus) => void;
}) {
  const labelId = useId();
  return (
    <div className="grid gap-2">
      <p id={labelId} className="font-medium text-xs">
        Status
      </p>
      <Tabs
        value={value ?? 'active'}
        onValueChange={(value) => onChange(value === 'active' ? undefined : value)}
      >
        <TabsList className="grid w-full grid-cols-2" aria-labelledby={labelId}>
          {RESOURCE_STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {value === 'active' ? 'Active' : 'Archived'}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
