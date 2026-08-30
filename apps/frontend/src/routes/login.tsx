import { createFileRoute, redirect } from '@tanstack/react-router';
import { LoginForm } from '../components/auth/login-form';
import { FormShell } from '../components/layout/form-shell';
import { ownerRegistrationQueryOptions } from '../queries/owner-registration';
import { Route as IndexRoute } from './index';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    if (context.session) {
      throw redirect({ href: search.redirect ?? IndexRoute.to });
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
    <FormShell
      eyebrow={ownerRegistered ? 'Welcome back' : 'First-time setup'}
      title={ownerRegistered ? 'Sign in' : 'Create the owner account'}
      description={
        ownerRegistered
          ? 'Use a registered passkey to open your private knowledge base.'
          : 'Register the first passkey to claim this Context Use instance.'
      }
    >
      <LoginForm ownerRegistered={ownerRegistered} redirectTo={search.redirect ?? IndexRoute.to} />
    </FormShell>
  );
}
