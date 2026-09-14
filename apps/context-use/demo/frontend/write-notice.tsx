import { Button, buttonVariants } from '@repo/ui/button';
import { CONTEXT_USE_DEPLOY_URL } from '@repo/ui/context-use-links';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '#frontend/components/ui/alert-dialog.tsx';

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
    <DemoNoticeDialog
      open={notice?.open ?? false}
      onClose={() => setNotice((current) => current && { ...current, open: false })}
      returnFocus={notice?.returnFocus}
    />
  );
}

export function DemoNoticeDialog({
  open,
  onClose,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}) {
  return (
    <AlertDialog
      open={open}
      // biome-ignore lint/complexity/useMaxParams: Base UI supplies the next state and event details.
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && details.reason === 'close-press') {
          onClose();
        } else {
          details.cancel();
        }
      }}
    >
      <AlertDialogContent finalFocus={() => returnFocus ?? false}>
        <AlertDialogTitle>This is a read-only demo</AlertDialogTitle>
        <AlertDialogDescription>
          Changes and account actions cannot be saved here. Deploy your own instance and connect
          your agents via MCP so you can all share and curate the same context.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline">Keep exploring</Button>} />
          <a
            href={CONTEXT_USE_DEPLOY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants()}
          >
            Deploy your own
            <ArrowUpRight aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
