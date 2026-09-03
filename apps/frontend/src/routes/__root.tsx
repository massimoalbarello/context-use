import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet, redirect } from '@tanstack/react-router';
import { Eyebrow } from '../components/layout/eyebrow';
import { buttonVariants } from '../components/ui/button';
import { cn } from '../lib/class-names';
import { MAIN_KNOWLEDGE_PATH } from '../lib/knowledge-navigation';
import { profileQueryOptions } from '../queries/profile';
import { sessionQueryOptions } from '../queries/session';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    const profile = session ? await context.queryClient.ensureQueryData(profileQueryOptions) : null;
    const setupPath = location.pathname === '/setup';
    const mcpAuthorizationPath = location.pathname === '/mcp/authorize';
    const firstEntityPath = location.pathname === '/entities/new';
    if (session && !profile && !setupPath && !mcpAuthorizationPath && !firstEntityPath) {
      throw redirect({ to: '/setup', search: { redirect: location.href } });
    }
    if (session && profile && setupPath) {
      throw redirect({ to: MAIN_KNOWLEDGE_PATH });
    }
    return { session, profile };
  },
  notFoundComponent: NotFoundRoute,
  component: RouteComponent,
});

function RouteComponent() {
  const { profile, session } = Route.useRouteContext();
  const showPublicHeader = !session;

  return (
    <div
      className={cn(
        'grid h-dvh min-h-0 overflow-hidden',
        showPublicHeader ? 'grid-rows-[auto_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)]',
      )}
    >
      {showPublicHeader && (
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 bg-sidebar/95 px-4 py-2 backdrop-blur md:min-h-16 md:flex-nowrap md:gap-5 md:px-8 md:py-0">
          <Link
            to="/"
            className="whitespace-nowrap font-semibold text-lg tracking-tight"
            activeOptions={{ exact: true }}
          >
            Context Use
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-3 whitespace-nowrap text-muted-foreground text-sm">
            <Link to="/login" className={buttonVariants({ variant: 'ghost' })}>
              Login
            </Link>
          </div>
        </header>
      )}
      <div className={cn('min-h-0', profile ? 'overflow-hidden' : 'overflow-y-auto')}>
        <Outlet />
      </div>
    </div>
  );
}

function NotFoundRoute() {
  const { profile } = Route.useRouteContext();
  return (
    <main
      className={cn(
        'grid min-h-full place-items-center px-5 py-12 md:px-8',
        profile && 'h-full bg-sidebar p-2 md:p-3',
      )}
    >
      <section
        className={cn(
          'w-full max-w-xl',
          profile &&
            'flex size-full max-w-none items-center overflow-y-auto rounded-2xl bg-card px-6 py-16',
        )}
      >
        <div className="mx-auto w-full max-w-xl">
          <Eyebrow>404</Eyebrow>
          <h1 className="mt-2 font-semibold text-4xl tracking-tight">Page not found</h1>
          <p className="mt-3 text-lg text-muted-foreground leading-relaxed">
            This address may be outdated or mistyped.
          </p>
          {profile ? (
            <Link
              className={buttonVariants({ size: 'lg', className: 'mt-7' })}
              to={MAIN_KNOWLEDGE_PATH}
              replace
            >
              Back to Hypermedia
            </Link>
          ) : (
            <Link className={buttonVariants({ size: 'lg', className: 'mt-7' })} to="/login">
              Go to sign in
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
