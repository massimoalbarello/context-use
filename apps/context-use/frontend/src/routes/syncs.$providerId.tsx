import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { ProviderDetail, type SyncProviderTab } from '../components/syncs/provider-detail';
import { SyncQueryState } from '../components/syncs/query-state';
import {
  useConfigureOAuthApp,
  useConnectSyncProvider,
  useUpdateManagedSync,
} from '../lib/hooks/use-managed-syncs';
import { managedSyncsQueryOptions } from '../queries/managed-syncs';

export function syncProviderSearch(search: Record<string, unknown>): {
  tab: SyncProviderTab;
  authorization?: 'failed';
} {
  return {
    tab: search.tab === 'authorization' ? 'authorization' : 'sync',
    authorization: search.authorization === 'failed' ? ('failed' as const) : undefined,
  };
}
export const Route = createFileRoute('/syncs/$providerId')({
  validateSearch: syncProviderSearch,
  component: SyncProviderRoute,
});
function SyncProviderRoute() {
  const { providerId } = Route.useParams();
  const { tab, authorization } = Route.useSearch();
  const navigate = Route.useNavigate();
  const query = useQuery({
    ...managedSyncsQueryOptions,
    refetchInterval: tab === 'sync' ? managedSyncsQueryOptions.refetchInterval : false,
  });
  const connect = useConnectSyncProvider();
  const configure = useConfigureOAuthApp();
  const update = useUpdateManagedSync();
  const provider = query.data?.find((item) => item.id === providerId);
  return (
    <div className="grid gap-7">
      <Link
        to="/syncs"
        className="flex w-fit items-center gap-2 text-muted-foreground text-sm hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All syncs
      </Link>
      <SyncQueryState query={query} />
      {query.isSuccess && !provider && <p role="alert">This sync provider is not available.</p>}
      {provider && (
        <ProviderDetail
          key={provider.id}
          provider={provider}
          tab={tab}
          authorizationFailed={authorization === 'failed'}
          pending={connect.isPending || configure.isPending || update.isPending}
          error={connect.error ?? update.error}
          appError={configure.error}
          onTabChange={(value) => {
            void navigate({ search: { tab: value } });
          }}
          onConnect={() => {
            connect.reset();
            connect.mutate(provider.id);
          }}
          onSaveApp={async (credentials) => {
            await configure.mutateAsync({ providerId: provider.id, credentials });
            configure.reset();
          }}
          onAction={(action) => update.mutate(action)}
        />
      )}
    </div>
  );
}
