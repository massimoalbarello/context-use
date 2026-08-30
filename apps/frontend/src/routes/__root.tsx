import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet, redirect } from '@tanstack/react-router';
import { SignOutButton } from '../components/auth/sign-out-button';
import { profileQueryOptions } from '../queries/profile';
import { sessionQueryOptions } from '../queries/session';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    const profile = session ? await context.queryClient.ensureQueryData(profileQueryOptions) : null;
    const setupPath = location.pathname === '/setup';
    if (session && !profile && !setupPath) {
      throw redirect({ to: '/setup', search: { redirect: location.href } });
    }
    if (session && profile && setupPath) {
      throw redirect({ to: '/pages' });
    }
    return { session, profile };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { profile, session } = Route.useRouteContext();

  return (
    <div className={profile ? 'app-shell app-shell-authenticated' : 'app-shell'}>
      {!profile && (
        <header className="app-header">
          <Link to="/" className="brand" activeOptions={{ exact: true }}>
            Context Use
          </Link>
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
      )}
      <div className="app-content">
        <Outlet />
      </div>
    </div>
  );
}
