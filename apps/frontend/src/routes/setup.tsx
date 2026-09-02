import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { AgentSetup } from '../components/setup/agent-setup';
import { buttonVariants } from '../components/ui/button';
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
    <main className="mx-auto grid min-h-full w-full max-w-3xl content-start gap-10 px-5 py-12 md:px-8 md:py-16">
      <header className="mx-auto grid max-w-2xl justify-items-center gap-3 text-center">
        <h1 className="font-semibold text-4xl tracking-tight">
          Set up Context Use with your agent
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          Connect once, then your agent can start curating your context.
        </p>
      </header>

      <AgentSetup mcpServerUrl={serverUrl} />

      <Link
        className={buttonVariants({
          variant: 'ghost',
          className: 'justify-self-center text-muted-foreground',
        })}
        to="/entities/new"
        search={{ redirect: redirectTo }}
      >
        Alternatively, set it up manually
      </Link>
    </main>
  );
}
