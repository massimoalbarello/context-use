import { Archive } from 'lucide-react';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog';
import { Button } from '../ui/button';

export function ResourceArchiveAction({
  blocked,
  pending,
  resource,
  onBlocked,
  onConfirm,
}: {
  blocked: boolean;
  pending: boolean;
  resource: 'entity' | 'page';
  onBlocked: () => void;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && blocked) {
          onBlocked();
          return;
        }
        setOpen(nextOpen);
      }}
    >
      <AlertDialogTrigger
        render={
          <Button variant="destructive" size="lg" type="button" disabled={pending}>
            <Archive data-icon="inline-start" aria-hidden="true" />
            {pending ? 'Archiving…' : 'Archive'}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogTitle>Archive this {resource}?</AlertDialogTitle>
        <AlertDialogDescription>
          It will no longer be available in your workspace. Its stored content will be preserved,
          but it cannot currently be restored.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
          <AlertDialogClose
            render={
              <Button
                variant="destructive"
                onClick={() => {
                  onConfirm();
                }}
              >
                Archive {resource}
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
