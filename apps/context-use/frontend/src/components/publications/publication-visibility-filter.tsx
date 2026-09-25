import { useId } from 'react';
import {
  PUBLICATION_VISIBILITIES,
  type PublicationVisibility,
} from '#backend/models/publications/model.ts';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

const LABELS: Record<PublicationVisibility, string> = {
  all: 'All',
  public: 'Public',
  private: 'Private',
};

export function PublicationVisibilityFilter({
  value,
  onChange,
}: {
  value?: PublicationVisibility;
  onChange: (value: PublicationVisibility | undefined) => void;
}) {
  const labelId = useId();
  return (
    <div className="grid gap-2">
      <p id={labelId} className="font-medium text-xs">
        Visibility
      </p>
      <Tabs
        value={value ?? 'all'}
        onValueChange={(option) => onChange(option === 'all' ? undefined : option)}
      >
        <TabsList className="grid w-full grid-cols-3" aria-labelledby={labelId}>
          {PUBLICATION_VISIBILITIES.map((option) => (
            <TabsTrigger key={option} value={option}>
              {LABELS[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
