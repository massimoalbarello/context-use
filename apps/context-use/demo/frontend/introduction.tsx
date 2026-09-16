import { Button } from '@repo/ui/button';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, DialogContent, DialogTitle } from '#frontend/components/ui/dialog.tsx';

const DISMISSED_KEY = 'context-use-demo-introduction-dismissed';

export function DemoIntroduction({ triggerContainer }: { triggerContainer: HTMLElement }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(() => {
    try {
      return window.sessionStorage.getItem(DISMISSED_KEY) !== 'true';
    } catch {
      return true;
    }
  });

  function close() {
    setOpen(false);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Dismissal still works when the browser blocks storage.
    }
  }

  return (
    <>
      {createPortal(
        <Button
          ref={trigger}
          variant="ghost"
          size="sm"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          About this demo
        </Button>,
        triggerContainer,
      )}
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            close();
          }
        }}
      >
        <DialogContent className="demo-surface" finalFocus={trigger}>
          <DialogTitle>All your context, in one place.</DialogTitle>
          <div className="space-y-4 text-sm leading-relaxed">
            <p>
              Everything you know, your agents should know too. Context Use gives your agents a
              shared place to access and curate your context.
            </p>
            <p>
              Explore Steve Jobs' personal context and imagine how much more useful your agents
              would be if they could truly know you.
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={close}>Explore the demo</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
