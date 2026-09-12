import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../src/components/ui/alert-dialog';
import { Button } from '../src/components/ui/button';

const FORBIDDEN = 403;
export const DEMO_WRITE_DENIED_EVENT = 'demo-write-denied';

/** Keep denied saves failed, but present expected demo restrictions outside form errors. */
export function demoFetch({
  fetch,
  onWriteDenied,
}: {
  fetch: Window['fetch'];
  onWriteDenied: () => void;
}): Window['fetch'] {
  return async (...args) => {
    const response = await fetch(...args);
    if (response.status !== FORBIDDEN) {
      return response;
    }
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    if (body?.code !== 'DEMO_READ_ONLY') {
      return response;
    }

    onWriteDenied();
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return Response.json({ ...body, message: '' }, { status: response.status, headers });
  };
}

export function DemoWriteNotice({ events }: { events: EventTarget }) {
  const [notice, setNotice] = useState<{ open: boolean; returnFocus: HTMLElement | null } | null>(
    null,
  );
  useEffect(() => {
    const show = (event: Event) => {
      const element = (event as CustomEvent<Element | null>).detail;
      setNotice({ open: true, returnFocus: element instanceof HTMLElement ? element : null });
    };
    events.addEventListener(DEMO_WRITE_DENIED_EVENT, show);
    return () => events.removeEventListener(DEMO_WRITE_DENIED_EVENT, show);
  }, [events]);

  return (
    <AlertDialog
      open={notice?.open ?? false}
      // biome-ignore lint/complexity/useMaxParams: Base UI supplies the next state and event details.
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && details.reason === 'close-press') {
          setNotice((current) => current && { ...current, open: false });
        } else {
          details.cancel();
        }
      }}
    >
      <AlertDialogContent finalFocus={() => notice?.returnFocus ?? false}>
        <AlertDialogTitle>This is a read-only demo</AlertDialogTitle>
        <AlertDialogDescription>
          Changes are disabled in this shared demo. You can keep exploring Steve’s context and
          trying the controls.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button>OK</Button>} />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
