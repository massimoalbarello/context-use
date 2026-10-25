import { Toast } from '@base-ui/react/toast';
import { Button } from '@repo/ui/button';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export const useToastManager = Toast.useToastManager;

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider>
      {children}
      <Toaster />
    </Toast.Provider>
  );
}

function Toaster() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed right-4 bottom-4 z-50 grid w-80 max-w-[calc(100vw-2rem)] gap-2">
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            className="flex items-center gap-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg data-[limited]:hidden"
          >
            <Toast.Content className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <Toast.Title className="font-medium text-sm" />
              {toast.actionProps && (
                <Toast.Action render={<Button variant="outline" size="sm" />} />
              )}
            </Toast.Content>
            <Toast.Close
              render={<Button variant="ghost" size="icon-sm" aria-label="Dismiss notification" />}
            >
              <X aria-hidden="true" />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
