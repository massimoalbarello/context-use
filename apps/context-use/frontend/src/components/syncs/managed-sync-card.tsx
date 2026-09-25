import { Button, buttonVariants } from '@repo/ui/button';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Pause, Play, RefreshCw } from 'lucide-react';
import type { ManagedSync } from '../../queries/managed-syncs';
import { Badge } from '../ui/badge';

const stateLabels = {
  'setup-required': 'Waiting for app setup',
  disconnected: 'Waiting for account',
  ready: 'Up to date',
  syncing: 'Syncing',
  paused: 'Paused',
  error: 'Needs attention',
} as const;
const MILLISECONDS_PER_MINUTE = 60_000;
export function ManagedSyncCard(input: {
  sync: ManagedSync;
  pending: boolean;
  onAction: (action: 'pause' | 'resume' | 'run') => void;
}) {
  const { sync } = input;
  const connected = sync.state !== 'setup-required' && sync.state !== 'disconnected';
  return (
    <section aria-label={sync.name} className="grid gap-6 py-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h2 className="font-semibold text-lg">{sync.name}</h2>
          <p className="text-muted-foreground text-sm">{sync.description}</p>
        </div>
        <Badge variant={sync.state === 'error' ? 'destructive' : 'secondary'}>
          {stateLabels[sync.state]}
        </Badge>
      </div>
      {sync.state !== 'ready' && (
        <p role="status" className="text-muted-foreground text-sm">
          {sync.message}
        </p>
      )}
      {connected && (
        <>
          <dl className="grid gap-5 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs">Last synced</dt>
              <dd className="mt-1 text-sm">
                {sync.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString() : 'Not yet'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Schedule</dt>
              <dd className="mt-1 text-sm">
                {sync.state === 'paused'
                  ? 'Paused'
                  : `Every ${sync.intervalMs / MILLISECONDS_PER_MINUTE} minutes`}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/app/records"
              search={{
                provider: sync.provider,
                kind: sync.kinds.length === 1 ? sync.kinds[0] : undefined,
              }}
              className={buttonVariants({ variant: 'outline' })}
            >
              View records
              <ArrowUpRight aria-hidden="true" />
            </Link>
            {sync.state !== 'paused' && (
              <Button
                variant="outline"
                disabled={input.pending || sync.state === 'syncing'}
                onClick={() => input.onAction('run')}
              >
                <RefreshCw aria-hidden="true" />
                Sync now
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={input.pending}
              onClick={() => input.onAction(sync.state === 'paused' ? 'resume' : 'pause')}
            >
              {sync.state === 'paused' ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              {sync.state === 'paused' ? 'Resume' : 'Pause'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
