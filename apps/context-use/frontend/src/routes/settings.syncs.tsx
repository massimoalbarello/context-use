import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { SyncSettings } from '../components/syncs/sync-settings';
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
  const recordEndpoint = `${applicationOrigin()}/api/records/batch`;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-10 md:px-10 md:py-12">
      <header>
        <h1 className="font-semibold text-3xl tracking-tight">Syncs</h1>
      </header>

      <SyncSettings
        syncs={data.items}
        created={create.data}
        recordEndpoint={recordEndpoint}
        creating={create.isPending}
        createError={create.error}
        revokingReadableId={revoke.isPending ? revoke.variables.syncReadableId : null}
        revokeError={revoke.error}
        onCreate={(name) => create.mutate({ name })}
        onResetCreate={create.reset}
        onRevoke={(syncReadableId) => revoke.mutate({ syncReadableId })}
      />
    </div>
  );
}
