import { Archive } from 'lucide-react';
import { Button } from '../ui/button';

export function ResourceArchiveButton({
  pending,
  onClick,
}: {
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="destructive" size="lg" type="button" disabled={pending} onClick={onClick}>
      <Archive data-icon="inline-start" aria-hidden="true" />
      {pending ? 'Archiving…' : 'Archive'}
    </Button>
  );
}
