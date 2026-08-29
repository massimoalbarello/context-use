import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { EntityForm } from '../components/entities/entity-form';
import { KnowledgePageList } from '../components/pages/knowledge-page-list';
import { useEntity } from '../lib/hooks/use-entity';
import { useUpdateEntity } from '../lib/hooks/use-update-entity';
import { entityQueryOptions } from '../queries/entities';

export const Route = createFileRoute('/entities/$id')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(entityQueryOptions(params.id)),
  component: EntityRoute,
});

function EntityRoute() {
  const { id } = Route.useParams();
  const { data: entity, error } = useEntity(id);
  const updateEntity = useUpdateEntity();

  if (error) {
    return <p className="page-shell error-message">{error.message}</p>;
  }
  if (!entity) {
    return null;
  }

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Entity · {entity.readableId}</p>
          <h1>{entity.name}</h1>
          <p>{entity.description}</p>
        </div>
        <Link className="secondary-action" to="/entities">
          All entities
        </Link>
      </header>

      <section className="split-layout">
        <div>
          <div className="section-heading">
            <h2>Mentioned by</h2>
            <span>{entity.pages.length}</span>
          </div>
          <KnowledgePageList pages={entity.pages} />
        </div>
        <div>
          <div className="section-heading">
            <h2>Identity</h2>
          </div>
          <EntityForm
            key={entity.updatedAt.toISOString()}
            initialValues={{
              readableId: entity.readableId,
              name: entity.name,
              description: entity.description,
            }}
            readableIdLocked
            pending={updateEntity.isPending}
            error={updateEntity.error}
            submitLabel="Save identity"
            onSubmit={({ name, description }) =>
              updateEntity.mutate({
                readableId: entity.readableId,
                body: { name, description },
              })
            }
          />
        </div>
      </section>
    </main>
  );
}
