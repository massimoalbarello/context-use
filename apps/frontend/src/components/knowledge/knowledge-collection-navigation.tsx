import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  type KnowledgeCollection,
  knowledgeResourceFromPath,
  readRememberedKnowledgeResource,
  writeRememberedKnowledgeResource,
} from '../../lib/knowledge-navigation';

function CollectionLink({
  collection,
  readableId,
  active,
}: {
  collection: KnowledgeCollection;
  readableId?: string;
  active: boolean;
}) {
  const sharedProps = {
    'data-active': active ? 'true' : undefined,
    'aria-current': active ? ('page' as const) : undefined,
    className:
      '-mb-px border-transparent border-b-2 px-1 py-3 font-medium text-muted-foreground text-sm hover:text-foreground data-[active=true]:border-foreground data-[active=true]:text-foreground',
  };
  const label = collection === 'pages' ? 'Pages' : 'Entities';

  if (collection === 'pages') {
    return readableId ? (
      <Link
        {...sharedProps}
        to="/pages/$id"
        params={{ id: readableId }}
        search={{ view: 'preview' }}
      >
        {label}
      </Link>
    ) : (
      <Link {...sharedProps} to="/pages">
        {label}
      </Link>
    );
  }

  return readableId ? (
    <Link {...sharedProps} to="/entities/$id" params={{ id: readableId }}>
      {label}
    </Link>
  ) : (
    <Link {...sharedProps} to="/entities">
      {label}
    </Link>
  );
}

export function KnowledgeCollectionNavigation({
  collection,
  ownerEntityId,
}: {
  collection: KnowledgeCollection;
  ownerEntityId: string;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const currentResource = knowledgeResourceFromPath(pathname);
  const [rememberedResources, setRememberedResources] = useState(() =>
    typeof window === 'undefined'
      ? {}
      : {
          pages: readRememberedKnowledgeResource({
            storage: window.sessionStorage,
            ownerEntityId,
            collection: 'pages',
          }),
          entities: readRememberedKnowledgeResource({
            storage: window.sessionStorage,
            ownerEntityId,
            collection: 'entities',
          }),
        },
  );
  const currentCollection = currentResource?.collection;
  const currentReadableId = currentResource?.readableId;

  useEffect(() => {
    if (!currentCollection || !currentReadableId) {
      return;
    }

    setRememberedResources((resources) => {
      if (resources[currentCollection] === currentReadableId) {
        return resources;
      }

      const nextResources = { ...resources, [currentCollection]: currentReadableId };
      writeRememberedKnowledgeResource({
        storage: window.sessionStorage,
        ownerEntityId,
        collection: currentCollection,
        readableId: currentReadableId,
      });
      return nextResources;
    });
  }, [currentCollection, currentReadableId, ownerEntityId]);

  const lastPageId = currentCollection === 'pages' ? currentReadableId : rememberedResources.pages;
  const lastEntityId =
    currentCollection === 'entities' ? currentReadableId : rememberedResources.entities;

  return (
    <nav className="flex min-w-0 gap-5" aria-label="Knowledge collections">
      <CollectionLink collection="pages" readableId={lastPageId} active={collection === 'pages'} />
      <CollectionLink
        collection="entities"
        readableId={lastEntityId}
        active={collection === 'entities'}
      />
    </nav>
  );
}
