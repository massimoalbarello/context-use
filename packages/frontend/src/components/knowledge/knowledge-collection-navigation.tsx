import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  type KnowledgeCollection,
  knowledgeResourceFromPath,
  readRememberedKnowledgeResource,
  writeRememberedKnowledgeResource,
} from '../../lib/knowledge-navigation';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

const COLLECTIONS: Array<{ value: KnowledgeCollection; label: string }> = [
  { value: 'entities', label: 'Entities' },
  { value: 'pages', label: 'Pages' },
  { value: 'assets', label: 'Assets' },
  { value: 'records', label: 'Records' },
];

export function KnowledgeCollectionNavigation({
  collection,
  ownerEntityReadableId,
}: {
  collection: KnowledgeCollection;
  ownerEntityReadableId: string;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const currentResource = knowledgeResourceFromPath(pathname);
  const [rememberedResources, setRememberedResources] = useState<
    Partial<Record<KnowledgeCollection, string>>
  >(() =>
    typeof window === 'undefined'
      ? {}
      : Object.fromEntries(
          COLLECTIONS.map(({ value }) => [
            value,
            readRememberedKnowledgeResource({
              storage: window.sessionStorage,
              ownerEntityReadableId,
              collection: value,
            }),
          ]),
        ),
  );

  useEffect(() => {
    if (!currentResource) {
      return;
    }
    setRememberedResources((resources) => {
      if (resources[currentResource.collection] === currentResource.readableId) {
        return resources;
      }
      writeRememberedKnowledgeResource({
        storage: window.sessionStorage,
        ownerEntityReadableId,
        collection: currentResource.collection,
        readableId: currentResource.readableId,
      });
      return { ...resources, [currentResource.collection]: currentResource.readableId };
    });
  }, [currentResource, ownerEntityReadableId]);

  function openCollection(next: KnowledgeCollection) {
    const readableId = rememberedResources[next];
    switch (next) {
      case 'entities':
        void (readableId
          ? navigate({ to: '/entities/$id', params: { id: readableId } })
          : navigate({ to: '/entities' }));
        return;
      case 'pages':
        void (readableId
          ? navigate({ to: '/pages/$id', params: { id: readableId }, search: { view: 'preview' } })
          : navigate({ to: '/pages' }));
        return;
      case 'assets':
        void (readableId
          ? navigate({ to: '/assets/$id', params: { id: readableId } })
          : navigate({ to: '/assets' }));
        return;
      case 'records':
        void (readableId
          ? navigate({ to: '/records/$id', params: { id: readableId } })
          : navigate({ to: '/records' }));
    }
  }

  return (
    <Select
      items={COLLECTIONS}
      value={collection}
      onValueChange={(nextCollection) => {
        if (nextCollection) {
          openCollection(nextCollection);
        }
      }}
    >
      <SelectTrigger className="h-10 min-w-0 flex-1 font-semibold" aria-label="Knowledge view">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {COLLECTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
