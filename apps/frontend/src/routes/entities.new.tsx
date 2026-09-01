import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { EntityForm, type EntityFormValues } from '../components/entities/entity-form';
import { DetailShell } from '../components/knowledge/detail-shell';
import { buttonVariants } from '../components/ui/button';
import { cn } from '../lib/class-names';
import { useCreateEntity } from '../lib/hooks/use-create-entity';
import { useCreateProfile } from '../lib/hooks/use-create-profile';
import { internalAppPath } from '../lib/internal-app-path';

const EMPTY_ENTITY: EntityFormValues = { name: '', description: '' };

export const Route = createFileRoute('/entities/new')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: internalAppPath(search.redirect),
  }),
  component: NewEntityRoute,
});

function NewEntityRoute() {
  const navigate = useNavigate();
  const { profile } = Route.useRouteContext();
  const { redirect: redirectTo } = Route.useSearch();
  const createEntity = useCreateEntity();
  const createProfile = useCreateProfile();
  const pending = profile ? createEntity.isPending : createProfile.isPending;
  const error = profile ? createEntity.error : createProfile.error;
  const content = (
    <>
      <header className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">
          {profile ? 'New entity' : 'Create your first entity'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {profile
            ? 'The permanent address will be derived from the entity’s name.'
            : 'Start with yourself. This entity anchors your workspace and can be mentioned like any other.'}
        </p>
      </header>
      <EntityForm
        initialValues={EMPTY_ENTITY}
        pending={pending}
        error={error}
        submitLabel={profile ? 'Create entity' : 'Create first entity'}
        onSubmit={(values) => {
          if (!profile) {
            createProfile.mutate(values, {
              onSuccess: async ({ selfEntity }) => {
                await navigate({
                  href: redirectTo ?? `/entities/${selfEntity.readableId}`,
                });
              },
            });
            return;
          }

          createEntity.mutate(values, {
            onSuccess: async ({ readableId }) => {
              await navigate({ to: '/entities/$id', params: { id: readableId } });
            },
          });
        }}
      />
    </>
  );

  if (!profile) {
    return (
      <main className="relative grid min-h-full w-full content-center px-5 py-12 md:px-8">
        <Link
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'absolute top-5 left-5 md:top-7 md:left-8',
          )}
          to="/setup"
          search={{ redirect: redirectTo }}
        >
          <ArrowLeft aria-hidden="true" />
          Back to agent bootstrap
        </Link>
        <div className="mx-auto grid w-full max-w-2xl gap-5">{content}</div>
      </main>
    );
  }

  return <DetailShell className="w-full max-w-2xl gap-5">{content}</DetailShell>;
}
