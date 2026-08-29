import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { SignOutButton } from '../components/auth/sign-out-button';
import { sessionQueryOptions } from '../queries/session';

// Where the backend serves the API reference, outside the router's route tree.
const OPENAPI_PATH = '/openapi';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    return { session };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();

  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand" activeOptions={{ exact: true }}>
          Context Use
        </Link>
        {session && (
          <nav aria-label="Knowledge">
            <Link to="/pages" activeProps={{ 'data-active': true }}>
              Pages
            </Link>
            <Link to="/entities" activeProps={{ 'data-active': true }}>
              Entities
            </Link>
          </nav>
        )}
        {/* A plain anchor, not a `Link`: the docs page is rendered by the server, not the router. */}
        <a href={OPENAPI_PATH} className="api-link">
          API docs
        </a>
        <div className="account-actions">
          {session ? (
            <>
              <span className="account-name">{session.user.name}</span>
              <SignOutButton />
            </>
          ) : (
            <Link
              to="/login"
              activeProps={{
                className: 'font-bold',
              }}
            >
              Login
            </Link>
          )}
        </div>
      </header>
      <Outlet />
    </>
  );
}
