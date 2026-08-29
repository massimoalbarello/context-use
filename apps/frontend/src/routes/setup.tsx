import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { EntityForm, type EntityFormValues } from '../components/entities/entity-form';
import { useCreateProfile } from '../lib/hooks/use-create-profile';

export const Route = createFileRoute('/setup')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: SetupRoute,
});

function SetupRoute() {
  const navigate = useNavigate();
  const { session } = Route.useRouteContext();
  const { redirect: redirectTo } = Route.useSearch();
  const createProfile = useCreateProfile();
  const initialValues: EntityFormValues = {
    readableId: '',
    name: session?.user.name ?? '',
    description: '',
  };

  return (
    <main className="setup-shell">
      <div className="setup-copy">
        <p className="eyebrow">One last step</p>
        <h1>Create your entity</h1>
        <p className="setup-description">
          This is how the knowledge base knows who “you” are. Pages can mention this entity just
          like any other, while the dashboard and future agents recognize it as yours.
        </p>
      </div>
      <EntityForm
        initialValues={initialValues}
        pending={createProfile.isPending}
        error={createProfile.error}
        submitLabel="Finish sign up"
        onSubmit={(values) =>
          createProfile.mutate(values, {
            onSuccess: async () => {
              await navigate({ href: redirectTo ?? '/pages' });
            },
          })
        }
      />
    </main>
  );
}
