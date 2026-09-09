import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  CopyableSyncValue,
  CreateSyncForm,
  NewSyncCredential,
  SyncList,
} from '../components/syncs/sync-settings';
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
      <header className="grid gap-3">
        <h1 className="font-semibold text-3xl tracking-tight">Syncs</h1>
        <p className="max-w-3xl text-muted-foreground leading-relaxed">
          Authorize external services to deliver Markdown records to this knowledge base.
        </p>
      </header>

      <section className="grid gap-4" aria-labelledby="record-endpoint-heading">
        <div className="grid gap-1">
          <h2 id="record-endpoint-heading" className="font-semibold text-xl">
            Record endpoint
          </h2>
          <p className="text-muted-foreground text-sm">
            Configure the external service to send record batches to this URL with its bearer API
            key.
          </p>
        </div>
        <CopyableSyncValue label="Record endpoint" value={recordEndpoint} />
      </section>

      <section className="grid gap-4" aria-labelledby="create-sync-heading">
        <div className="grid gap-1">
          <h2 id="create-sync-heading" className="font-semibold text-xl">
            Create sync
          </h2>
          <p className="text-muted-foreground text-sm">
            Each sync gets a separate key, so every delivered record retains its source.
          </p>
        </div>
        {create.data ? (
          <NewSyncCredential
            created={create.data}
            recordEndpoint={recordEndpoint}
            onDone={create.reset}
          />
        ) : (
          <CreateSyncForm
            pending={create.isPending}
            error={create.error}
            onSubmit={(name) => create.mutate({ name })}
          />
        )}
      </section>

      <SyncList
        syncs={data.items}
        revokingReadableId={revoke.isPending ? revoke.variables.syncReadableId : null}
        error={revoke.error}
        onRevoke={(syncReadableId) => revoke.mutate({ syncReadableId })}
      />
    </div>
  );
}
