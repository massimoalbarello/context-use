import { Link } from '@tanstack/react-router';

type KnowledgeResource = 'page' | 'entity';

const resourceCopy = {
  page: {
    eyebrow: 'Knowledge page',
    collection: 'pages',
    collectionPath: '/pages',
  },
  entity: {
    eyebrow: 'Entity',
    collection: 'entities',
    collectionPath: '/entities',
  },
} as const;

export function WorkspaceResourceError({
  resource,
  error,
  retry,
}: {
  resource: KnowledgeResource;
  error: Error;
  retry: () => void;
}) {
  const copy = resourceCopy[resource];
  const notFound = error.message.toLocaleLowerCase().includes('not found');

  return (
    <div className="workspace-empty workspace-resource-error">
      <p className="eyebrow">{copy.eyebrow}</p>
      <h2>{notFound ? `${copy.eyebrow} not found` : `Couldn’t load this ${resource}`}</h2>
      <p className="workspace-description">
        {notFound
          ? `This ${resource} may have been removed, or its address may be out of date.`
          : `Something prevented this ${resource} from loading. You can try again or return to your ${copy.collection}.`}
      </p>
      <div className="action-row workspace-resource-actions">
        <Link className="primary-action" to={copy.collectionPath} replace>
          Back to {copy.collection}
        </Link>
        {!notFound && (
          <button className="secondary-action" type="button" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
