import { Archive } from 'lucide-react';
import { Button } from '../ui/button';

export function ResourceArchiveButton({
  blocked,
  pending,
  onClick,
}: {
  blocked: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="destructive"
      size="lg"
      type="button"
      disabled={pending || blocked}
      title={blocked ? 'Remove every active inbound relationship before archiving.' : undefined}
      onClick={onClick}
    >
      <Archive data-icon="inline-start" aria-hidden="true" />
      {pending ? 'Archiving…' : 'Archive'}
    </Button>
  );
}
