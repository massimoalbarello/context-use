export type KnowledgeCollection = 'pages' | 'entities';

type NavigationStorage = Pick<Storage, 'getItem' | 'setItem'>;

function storageKey(options: { ownerEntityId: string; collection: KnowledgeCollection }): string {
  return `context-use:knowledge-navigation:${options.ownerEntityId}:${options.collection}`;
}

export function knowledgeResourceFromPath(
  pathname: string,
): { collection: KnowledgeCollection; readableId: string } | null {
  const match = /^\/(pages|entities)\/([^/]+)\/?$/.exec(pathname);
  const collection = match?.[1];
  const encodedReadableId = match?.[2];
  if (!collection || !encodedReadableId || encodedReadableId === 'new') {
    return null;
  }

  try {
    return {
      collection: collection as KnowledgeCollection,
      readableId: decodeURIComponent(encodedReadableId),
    };
  } catch {
    return null;
  }
}

export function readRememberedKnowledgeResource(options: {
  storage: Pick<NavigationStorage, 'getItem'>;
  ownerEntityId: string;
  collection: KnowledgeCollection;
}): string | undefined {
  try {
    return options.storage.getItem(storageKey(options)) || undefined;
  } catch {
    return undefined;
  }
}

export function writeRememberedKnowledgeResource(options: {
  storage: Pick<NavigationStorage, 'setItem'>;
  ownerEntityId: string;
  collection: KnowledgeCollection;
  readableId: string;
}): void {
  try {
    options.storage.setItem(storageKey(options), options.readableId);
  } catch {
    // Navigation still works through the collection index when session storage is unavailable.
  }
}
