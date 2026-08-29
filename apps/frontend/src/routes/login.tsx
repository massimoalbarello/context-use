import { createFileRoute, redirect } from '@tanstack/react-router';
import { LoginForm } from '../components/auth/login-form';
import { FormShell } from '../components/layout/form-shell';
import { Route as IndexRoute } from './index';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    if (context.session) {
      throw redirect({ href: search.redirect ?? IndexRoute.to });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  return (
    <FormShell
      eyebrow="Passkey access"
      title="Your private knowledge base"
      description="Sign in with an existing passkey, or create the owner account when setting up this instance for the first time."
    >
      <LoginForm redirectTo={search.redirect ?? IndexRoute.to} />
    </FormShell>
  );
}
