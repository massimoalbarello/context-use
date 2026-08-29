import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { EntityForm, type EntityFormValues } from '../components/entities/entity-form';
import { EntityList } from '../components/entities/entity-list';
import { useCreateEntity } from '../lib/hooks/use-create-entity';
import { useEntities } from '../lib/hooks/use-entities';
import { entitiesQueryOptions } from '../queries/entities';

const EMPTY_ENTITY: EntityFormValues = { readableId: '', name: '', description: '' };

export const Route = createFileRoute('/entities/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(entitiesQueryOptions),
  component: EntitiesRoute,
});

function EntitiesRoute() {
  const navigate = useNavigate();
  const { data: entities = [], error } = useEntities();
  const createEntity = useCreateEntity();

  const create = (values: EntityFormValues) => {
    createEntity.mutate(values, {
      onSuccess: async () => {
        await navigate({
          to: '/entities/$id',
          params: { id: values.readableId },
        });
      },
    });
  };

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Coordinates</p>
          <h1>Entities</h1>
          <p>Stable identities that pages can mention without turning them into pages.</p>
        </div>
      </header>

      <section className="split-layout">
        <div>
          <div className="section-heading">
            <h2>Known entities</h2>
            <span>{entities.length}</span>
          </div>
          {error ? (
            <p className="error-message">{error.message}</p>
          ) : (
            <EntityList entities={entities} />
          )}
        </div>
        <div>
          <div className="section-heading">
            <h2>Create an entity</h2>
          </div>
          <EntityForm
            initialValues={EMPTY_ENTITY}
            pending={createEntity.isPending}
            error={createEntity.error}
            submitLabel="Create entity"
            onSubmit={create}
          />
        </div>
      </section>
    </main>
  );
}
