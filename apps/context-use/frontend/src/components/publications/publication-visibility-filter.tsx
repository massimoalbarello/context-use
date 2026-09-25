import { Button } from '@repo/ui/button';
import { useId } from 'react';
import {
  PUBLICATION_VISIBILITIES,
  type PublicationVisibility,
} from '#backend/models/publications/model.ts';

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
    <fieldset aria-labelledby={labelId} className="flex flex-wrap items-center gap-2">
      <span id={labelId} className="mr-1 text-muted-foreground text-sm">
        Visibility
      </span>
      {PUBLICATION_VISIBILITIES.map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={(value ?? 'all') === option ? 'secondary' : 'ghost'}
          aria-pressed={(value ?? 'all') === option}
          onClick={() => onChange(option === 'all' ? undefined : option)}
        >
          {LABELS[option]}
        </Button>
      ))}
    </fieldset>
  );
}
