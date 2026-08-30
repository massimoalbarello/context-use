import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { EntityForm, type EntityFormValues } from '../components/entities/entity-form';
import { DetailShell } from '../components/knowledge/detail-shell';
import { useCreateEntity } from '../lib/hooks/use-create-entity';

const EMPTY_ENTITY: EntityFormValues = { readableId: '', name: '', description: '' };

export const Route = createFileRoute('/entities/new')({
  component: NewEntityRoute,
});

function NewEntityRoute() {
  const navigate = useNavigate();
  const createEntity = useCreateEntity();

  return (
    <DetailShell className="w-full max-w-2xl gap-5">
      <header className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">New entity</h1>
        <p className="text-muted-foreground text-sm">
          The permanent address will be derived from the entity’s name.
        </p>
      </header>
      <EntityForm
        initialValues={EMPTY_ENTITY}
        pending={createEntity.isPending}
        error={createEntity.error}
        submitLabel="Create entity"
        onSubmit={(values) =>
          createEntity.mutate(values, {
            onSuccess: async ({ readableId }) => {
              await navigate({ to: '/entities/$id', params: { id: readableId } });
            },
          })
        }
      />
    </DetailShell>
  );
}
