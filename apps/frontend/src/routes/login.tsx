import { createFileRoute, redirect } from '@tanstack/react-router';
import { LoginForm } from '../components/auth/login-form';
import { FormShell } from '../components/layout/form-shell';
import { internalAppPath } from '../lib/internal-app-path';
import { ownerRegistrationQueryOptions } from '../queries/owner-registration';

const DEFAULT_REDIRECT = '/map';

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
    <FormShell
      eyebrow={ownerRegistered ? 'Welcome back' : 'First-time setup'}
      title={ownerRegistered ? 'Sign in' : 'Create the owner account'}
      description={
        ownerRegistered
          ? 'Use a registered passkey to open your private knowledge base.'
          : 'Register the first passkey to claim this Context Use instance.'
      }
    >
      <LoginForm
        ownerRegistered={ownerRegistered}
        redirectTo={search.redirect ?? DEFAULT_REDIRECT}
      />
    </FormShell>
  );
}
