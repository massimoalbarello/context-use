import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { SyncCreation, SyncList } from '../components/syncs/sync-settings';
import { applicationOrigin } from '../lib/application-origin';
import { useCreateRecordSync, useRevokeRecordSync } from '../lib/hooks/use-syncs';
import { recordSyncsQueryOptions } from '../queries/syncs';

export const Route = createFileRoute('/settings/syncs')({
  loader: ({ context }) => context.queryClient.ensureQueryData(recordSyncsQueryOptions),
  component: SyncSettingsRoute,
});

function SyncSettingsRoute() {
  const { data } = useSuspenseQuery(recordSyncsQueryOptions);
  const create = useCreateRecordSync();
  const revoke = useRevokeRecordSync();
  const recordEndpoint = `${applicationOrigin()}/api/records`;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-10 md:px-10 md:py-12">
      <header>
        <h1 className="font-semibold text-3xl tracking-tight">Syncs</h1>
      </header>

      <SyncCreation
        created={create.data}
        recordEndpoint={recordEndpoint}
        pending={create.isPending}
        error={create.error}
        onSubmit={(name) => create.mutate({ name })}
        onReset={create.reset}
      />

      <SyncList
        syncs={data.items}
        revokingReadableId={revoke.isPending ? revoke.variables.syncReadableId : null}
        error={revoke.error}
        onRevoke={(syncReadableId) => revoke.mutate({ syncReadableId })}
      />
    </div>
  );
}
