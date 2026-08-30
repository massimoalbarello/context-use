import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { EntityForm, type EntityFormValues } from '../components/entities/entity-form';
import { useCreateEntity } from '../lib/hooks/use-create-entity';

const EMPTY_ENTITY: EntityFormValues = { readableId: '', name: '', description: '' };

export const Route = createFileRoute('/entities/new')({
  component: NewEntityRoute,
});

function NewEntityRoute() {
  const navigate = useNavigate();
  const createEntity = useCreateEntity();

  return (
    <div className="detail-shell editor-shell editor-shell-narrow">
      <header className="editor-header">
        <h1>New entity</h1>
        <p>The permanent address will be derived from the entity’s name.</p>
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
    </div>
  );
}
