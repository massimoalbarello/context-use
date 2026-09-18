import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { SyncQueryState } from '../components/syncs/query-state';
import { Badge } from '../components/ui/badge';
import { managedSyncsQueryOptions } from '../queries/managed-syncs';

export const Route = createFileRoute('/syncs/')({ component: SyncsIndex });
function SyncsIndex() {
  const query = useQuery(managedSyncsQueryOptions);
  return (
    <div className="grid gap-9">
      <header className="grid gap-2">
        <h1 className="font-semibold text-3xl tracking-tight">Syncs</h1>
        <p className="text-muted-foreground">
          Connect your accounts and bring your activity into Context Use.
        </p>
      </header>
      <SyncQueryState query={query} />
      <div className="grid gap-4 sm:grid-cols-2">
        {query.data?.map((provider) => (
          <Link
            key={provider.id}
            to="/syncs/$providerId"
            params={{ providerId: provider.id }}
            search={{
              tab:
                !provider.oauthApp.configured || provider.account.status === 'disconnected'
                  ? 'authorization'
                  : 'sync',
            }}
            className="group grid gap-5 rounded-xl border p-6 transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-ring"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <RefreshCw aria-hidden="true" className="size-5 text-muted-foreground" />
                <h2 className="font-semibold text-lg">{provider.name}</h2>
              </div>
              <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">{provider.description}</p>
            <div>
              <Badge variant="secondary">
                {!provider.oauthApp.configured
                  ? 'App setup needed'
                  : provider.account.status === 'disconnected'
                    ? 'Account not connected'
                    : provider.account.status === 'error'
                      ? 'Account needs attention'
                      : 'Connected'}
              </Badge>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
