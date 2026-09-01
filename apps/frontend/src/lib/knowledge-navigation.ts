export type KnowledgeCollection = 'entities' | 'pages' | 'assets';

type NavigationStorage = Pick<Storage, 'getItem' | 'setItem'>;
const NAVIGATION_STORAGE_PREFIX = 'context-use:knowledge-navigation:';

function storageKey(options: {
  ownerEntityReadableId: string;
  collection: KnowledgeCollection;
}): string {
  return `${NAVIGATION_STORAGE_PREFIX}${options.ownerEntityReadableId}:${options.collection}`;
}

export function clearRememberedKnowledgeResources(
  storage: Pick<Storage, 'key' | 'length' | 'removeItem'>,
): void {
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(NAVIGATION_STORAGE_PREFIX)) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Authentication still completes when session storage is unavailable.
  }
}

export function knowledgeResourceFromPath(
  pathname: string,
): { collection: KnowledgeCollection; readableId: string } | null {
  const match = /^\/(entities|pages|assets)\/([^/]+)\/?$/.exec(pathname);
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
  ownerEntityReadableId: string;
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
  ownerEntityReadableId: string;
  collection: KnowledgeCollection;
  readableId: string;
}): void {
  try {
    options.storage.setItem(storageKey(options), options.readableId);
  } catch {
    // Navigation still works through the collection index when session storage is unavailable.
  }
}
