import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ClientList } from '../components/mcp/client-list';
import { McpServerUrl } from '../components/mcp/mcp-server-url';
import { mcpClientsQueryOptions } from '../queries/mcp-clients';

export const Route = createFileRoute('/settings/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(mcpClientsQueryOptions),
  component: McpSettingsRoute,
});

function McpSettingsRoute() {
  const { data } = useSuspenseQuery(mcpClientsQueryOptions);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-10 md:px-10 md:py-12">
      <header className="grid gap-3">
        <h1 className="font-semibold text-3xl tracking-tight">MCP</h1>
        <p className="max-w-3xl text-muted-foreground leading-relaxed">
          Connect MCP clients to this knowledge base and manage their access.
        </p>
      </header>

      <section className="grid gap-4" aria-labelledby="mcp-server-heading">
        <div className="grid gap-1">
          <h2 id="mcp-server-heading" className="font-semibold text-xl">
            Server URL
          </h2>
          <p className="text-muted-foreground text-sm">
            Paste this Streamable HTTP URL into an MCP client to connect it to Context Use.
          </p>
        </div>
        <McpServerUrl serverUrl={data.serverUrl} />
      </section>

      <ClientList clients={data.items} />
    </div>
  );
}
