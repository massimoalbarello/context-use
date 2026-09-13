import type { HypermediaEntityReference } from '../../queries/hypermedia';
import { hypermediaEntityKey } from '../../queries/hypermedia';

export type HypermediaSelection = {
  kind: 'page' | 'entity';
  readableId: string;
};

export const MAX_SELECTED_HYPERMEDIA_ENTITIES = 24;
const MAX_HYPERMEDIA_READABLE_ID_LENGTH = 120;
const HYPERMEDIA_READABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function hypermediaSelectionKey(selection: HypermediaSelection): string {
  return `${selection.kind}:${selection.readableId}`;
}

export function selectedHypermediaEntityKeys(entities: HypermediaEntityReference[]): Set<string> {
  return new Set(entities.map(hypermediaEntityKey));
}

function entityReferenceFromKey(key: string): HypermediaEntityReference | undefined {
  const separator = key.indexOf(':');
  const kind = key.slice(0, separator);
  const readableId = key.slice(separator + 1);
  return kind === 'entity' &&
    readableId.length > 0 &&
    readableId.length <= MAX_HYPERMEDIA_READABLE_ID_LENGTH &&
    HYPERMEDIA_READABLE_ID_PATTERN.test(readableId)
    ? { readableId }
    : undefined;
}

export function selectedHypermediaEntities(value: unknown): HypermediaEntityReference[] {
  if (typeof value !== 'string') {
    return [];
  }
  const entities = new Map<string, HypermediaEntityReference>();
  for (const key of value.split(',')) {
    const entity = entityReferenceFromKey(key);
    if (entity) {
      entities.set(hypermediaEntityKey(entity), entity);
    }
    if (entities.size === MAX_SELECTED_HYPERMEDIA_ENTITIES) {
      break;
    }
  }
  return [...entities.values()];
}

export function selectedHypermediaEntitiesValue(
  entities: HypermediaEntityReference[],
): string | undefined {
  return entities.length > 0 ? entities.map(hypermediaEntityKey).join(',') : undefined;
}

export function toggleHypermediaEntitySelection({
  entities,
  selection,
}: {
  entities: HypermediaEntityReference[];
  selection: HypermediaSelection;
}): HypermediaEntityReference[] {
  if (selection.kind === 'page') {
    return entities;
  }
  const entity = { readableId: selection.readableId };
  const key = hypermediaEntityKey(entity);
  if (entities.some((item) => hypermediaEntityKey(item) === key)) {
    return entities.filter((item) => hypermediaEntityKey(item) !== key);
  }
  return entities.length === MAX_SELECTED_HYPERMEDIA_ENTITIES ? entities : [...entities, entity];
}

export function removeHypermediaEntitySelection({
  entities,
  selection,
}: {
  entities: HypermediaEntityReference[];
  selection: HypermediaSelection;
}): HypermediaEntityReference[] {
  if (selection.kind === 'page') {
    return entities;
  }
  const key = hypermediaSelectionKey(selection);
  return entities.filter((entity) => hypermediaEntityKey(entity) !== key);
}
