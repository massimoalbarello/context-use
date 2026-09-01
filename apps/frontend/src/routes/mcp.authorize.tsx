import { useMutation } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { FormShell } from '../components/layout/form-shell';
import { ConnectionNameForm } from '../components/mcp-connections/connection-name-form';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { authClient } from '../lib/auth';
import {
  approveMcpConnection,
  mcpAuthorizationClientQueryOptions,
} from '../queries/mcp-connections';

type AuthorizationSearch = {
  client_id?: string;
  scope?: string;
  claims?: string;
  oauth_query?: string;
};

export const Route = createFileRoute('/mcp/authorize')({
  validateSearch: (search: Record<string, unknown>): AuthorizationSearch => ({
    client_id: typeof search.client_id === 'string' ? search.client_id : undefined,
    scope: typeof search.scope === 'string' ? search.scope : undefined,
    claims: typeof search.claims === 'string' ? search.claims : undefined,
    oauth_query: typeof search.oauth_query === 'string' ? search.oauth_query : undefined,
  }),
  beforeLoad: ({ context, location, search }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    if (!search.client_id) {
      throw new Error('OAuth authorization is missing its client identity.');
    }
  },
  loaderDeps: ({ search }) => ({ clientId: search.client_id! }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(mcpAuthorizationClientQueryOptions(deps.clientId)),
  component: McpAuthorizeRoute,
});

function redirectFromConsent(data: { redirect?: boolean; url?: string } | null | undefined) {
  if (data?.url) {
    window.location.assign(data.url);
  }
}

function McpAuthorizeRoute() {
  const client = Route.useLoaderData();
  const search = Route.useSearch();
  const approval = useMutation({
    mutationFn: async (name: string) => {
      await approveMcpConnection({ clientId: search.client_id!, name });
      const { data, error } = await authClient.oauth2.consent({
        accept: true,
        scope: search.scope,
        claims: search.claims,
      });
      if (error) {
        throw new Error(error.message ?? 'Could not authorize this MCP client.');
      }
      redirectFromConsent(data);
    },
  });
  const denial = useMutation({
    mutationFn: async () => {
      const { data, error } = await authClient.oauth2.consent({ accept: false });
      if (error) {
        throw new Error(error.message ?? 'Could not deny this MCP client.');
      }
      redirectFromConsent(data);
    },
  });
  const suggestedName = client.suggestedName ?? 'MCP connection';

  return (
    <FormShell
      eyebrow="MCP authorization"
      title="Connect an MCP client"
      description="Approve this client only if you started the connection. The name you choose is the identity Context Use will show in future activity."
    >
      <Card>
        <CardContent>
          <ConnectionNameForm
            initialName={suggestedName}
            pending={approval.isPending || denial.isPending}
            error={approval.error ?? denial.error}
            submitLabel="Approve connection"
            description={
              client.verifiedClientId
                ? `Verified client metadata suggested “${suggestedName}”. You can replace it.`
                : 'Choose a name you will recognize. Client-reported names are not treated as identity.'
            }
            onSubmit={(name) => approval.mutate(name)}
            secondaryAction={
              <Button
                variant="outline"
                type="button"
                disabled={approval.isPending || denial.isPending}
                onClick={() => denial.mutate()}
              >
                Deny
              </Button>
            }
          />
        </CardContent>
      </Card>
    </FormShell>
  );
}
