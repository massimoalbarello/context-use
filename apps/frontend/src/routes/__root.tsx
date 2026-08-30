import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet, redirect } from '@tanstack/react-router';
import { SignOutButton } from '../components/auth/sign-out-button';
import { buttonVariants } from '../components/ui/button';
import { cn } from '../lib/class-names';
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
    <div
      className={cn(
        'grid h-dvh min-h-0 overflow-hidden',
        profile ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]',
      )}
    >
      {!profile && (
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 bg-sidebar/95 px-4 py-2 backdrop-blur md:min-h-16 md:flex-nowrap md:gap-5 md:px-8 md:py-0">
          <Link
            to="/"
            className="whitespace-nowrap font-semibold text-lg tracking-tight"
            activeOptions={{ exact: true }}
          >
            Context Use
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-3 whitespace-nowrap text-muted-foreground text-sm">
            {session ? (
              <>
                <span className="hidden max-w-48 truncate lg:inline">{session.user.name}</span>
                <SignOutButton />
              </>
            ) : (
              <Link to="/login" className={buttonVariants({ variant: 'ghost' })}>
                Login
              </Link>
            )}
          </div>
        </header>
      )}
      <div className={cn('min-h-0', profile ? 'overflow-hidden' : 'overflow-y-auto')}>
        <Outlet />
      </div>
    </div>
  );
}
