import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { ConnectionList } from '../components/mcp-connections/connection-list';
import { buttonVariants } from '../components/ui/button';
import { cn } from '../lib/class-names';
import { mcpConnectionsQueryOptions } from '../queries/mcp-connections';

export const Route = createFileRoute('/connections')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(mcpConnectionsQueryOptions),
  component: ConnectionsRoute,
});

function ConnectionsRoute() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-12 md:px-8">
      <Link className={cn(buttonVariants({ variant: 'ghost' }), 'mb-8')} to="/pages">
        <ArrowLeft aria-hidden="true" />
        Back to workspace
      </Link>
      <h1 className="font-semibold text-3xl tracking-tight">MCP connections</h1>
      <p className="mt-3 mb-8 text-muted-foreground leading-relaxed">
        Name the agent clients that can use this knowledge base, and revoke access you no longer
        recognize. Access tokens last five minutes; rotated refresh credentials avoid routine
        reconnection and are revoked immediately when you archive a connection. The provider
        requires a finite refresh window, renewed on use, so a client idle for ten years must be
        approved again.
      </p>
      <ConnectionList />
    </main>
  );
}
