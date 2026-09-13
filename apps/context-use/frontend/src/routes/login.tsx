import { AnimatedContextUseLogo } from '@repo/ui/animated-context-use-logo';
import { ContextUseBrand } from '@repo/ui/context-use-brand';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { LoginForm } from '../components/auth/login-form';
import { Eyebrow } from '../components/layout/eyebrow';
import { internalAppPath } from '../lib/internal-app-path';
import { MAIN_KNOWLEDGE_PATH } from '../lib/knowledge-navigation';
import { ownerRegistrationQueryOptions } from '../queries/owner-registration';

const DEFAULT_REDIRECT = MAIN_KNOWLEDGE_PATH;

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: internalAppPath(search.redirect),
  }),
  beforeLoad: async ({ context, search }) => {
    if (context.session) {
      throw redirect({ href: search.redirect ?? DEFAULT_REDIRECT });
    }
    return {
      ownerRegistered: (await context.queryClient.fetchQuery(ownerRegistrationQueryOptions))
        .ownerRegistered,
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { ownerRegistered } = Route.useRouteContext();
  const search = Route.useSearch();
  return (
    <main className="grid min-h-full grid-rows-[50dvh_1fr] lg:grid-cols-2 lg:grid-rows-1">
      <div className="dark relative lg:sticky lg:top-0 lg:h-dvh">
        <AnimatedContextUseLogo className="absolute inset-0 size-full" />
        <Link
          to="/"
          className="absolute top-6 left-6 z-10 inline-flex text-foreground sm:top-8 sm:left-8"
        >
          <ContextUseBrand className="text-lg" />
        </Link>
      </div>
      <section className="flex min-w-0 items-center justify-center bg-background px-6 py-12 sm:px-10 lg:px-16">
        <div className="w-full max-w-sm">
          <Eyebrow>{ownerRegistered ? 'Welcome back' : 'First-time setup'}</Eyebrow>
          <h1 className="mt-3 font-semibold text-3xl tracking-tight sm:text-4xl">
            {ownerRegistered ? 'Sign in' : 'Create the owner account'}
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            {ownerRegistered
              ? 'Use a registered passkey to open your private knowledge base.'
              : 'Register the first passkey to claim this Context Use instance.'}
          </p>
          <div className="mt-8">
            <LoginForm
              ownerRegistered={ownerRegistered}
              redirectTo={search.redirect ?? DEFAULT_REDIRECT}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
