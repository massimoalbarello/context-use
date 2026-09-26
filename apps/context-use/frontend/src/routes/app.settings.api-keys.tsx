import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ApiKeySettings } from '../components/api-keys/api-key-settings';
import { applicationOrigin } from '../lib/application-origin';
import { useCreateApiKey, useRevokeApiKey } from '../lib/hooks/use-api-keys';
import { apiKeysQueryOptions } from '../queries/api-keys';

export const Route = createFileRoute('/app/settings/api-keys')({
  loader: ({ context }) => context.queryClient.ensureQueryData(apiKeysQueryOptions),
  component: ApiKeySettingsRoute,
});

function ApiKeySettingsRoute() {
  const { data } = useSuspenseQuery(apiKeysQueryOptions);
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const recordEndpoint = `${applicationOrigin()}/api/records`;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-10 md:px-10 md:py-12">
      <header>
        <h1 className="font-semibold text-3xl tracking-tight">API keys</h1>
      </header>

      <ApiKeySettings
        keys={data.items}
        created={create.data}
        recordEndpoint={recordEndpoint}
        creating={create.isPending}
        createError={create.error}
        revokingReadableId={revoke.isPending ? revoke.variables.keyReadableId : null}
        revokeError={revoke.error}
        onCreate={(name) => create.mutate({ name })}
        onResetCreate={create.reset}
        onRevoke={(keyReadableId) => revoke.mutate({ keyReadableId })}
      />
    </div>
  );
}
