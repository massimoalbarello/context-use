import { useLayoutEffect } from 'react';
import type { McpAppClient } from './client';

export function useContentSize({ client, ready }: { client: McpAppClient; ready: boolean }) {
  // Keep the host's previous iframe height until the destination has rendered.
  useLayoutEffect(() => {
    if (ready) {
      return client.app.setupSizeChangedNotifications();
    }
  }, [client, ready]);
}

export function WidgetLoading({ label }: { label: string }) {
  return (
    <div role="status" className="py-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
        <div className="h-3 w-24 rounded-full bg-muted" />
        <div className="h-6 w-2/3 rounded-md bg-muted" />
        <div className="space-y-2 pt-2">
          <div className="h-3 w-11/12 rounded-full bg-muted" />
          <div className="h-3 w-4/5 rounded-full bg-muted" />
        </div>
      </div>
    </div>
  );
}
