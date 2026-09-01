import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { AgentSetup } from '../components/setup/agent-setup';
import { buttonVariants } from '../components/ui/button';
import { applicationOrigin } from '../lib/application-origin';
import { internalAppPath } from '../lib/internal-app-path';
import { mcpClientsQueryOptions } from '../queries/mcp-clients';

export const Route = createFileRoute('/setup')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: internalAppPath(search.redirect),
  }),
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(mcpClientsQueryOptions),
  component: SetupRoute,
});

function SetupRoute() {
  const { redirect: redirectTo } = Route.useSearch();
  const { serverUrl } = Route.useLoaderData();

  return (
    <main className="mx-auto grid min-h-full w-full max-w-3xl content-center gap-7 px-5 py-10 md:px-8">
      <header className="mx-auto grid max-w-2xl justify-items-center gap-3 text-center">
        <h1 className="font-semibold text-4xl tracking-tight">
          Bootstrap context-use with your agent
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          Paste the prompt below into your favorite MCP-capable agent to curate your context.
        </p>
      </header>

      <AgentSetup applicationUrl={applicationOrigin()} mcpServerUrl={serverUrl} />

      <Link
        className={buttonVariants({ variant: 'ghost', className: 'justify-self-center' })}
        to="/entities/new"
        search={{ redirect: redirectTo }}
      >
        Skip and create your first entity manually
      </Link>
    </main>
  );
}
