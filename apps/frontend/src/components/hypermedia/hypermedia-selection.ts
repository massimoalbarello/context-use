import type { HypermediaResourceReference } from '../../queries/hypermedia';
import { hypermediaResourceKey } from '../../queries/hypermedia';

export type HypermediaSelection = {
  kind: 'page' | 'entity';
  readableId: string;
};

export const MAX_SELECTED_HYPERMEDIA_RESOURCES = 24;
const MAX_HYPERMEDIA_READABLE_ID_LENGTH = 120;
const HYPERMEDIA_READABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function hypermediaSelectionKey(selection: HypermediaSelection): string {
  return `${selection.kind}:${selection.readableId}`;
}

export function selectedHypermediaResourceKeys(
  resources: HypermediaResourceReference[],
): Set<string> {
  return new Set(resources.map(hypermediaResourceKey));
}

function resourceReferenceFromKey(key: string): HypermediaResourceReference | undefined {
  const separator = key.indexOf(':');
  const kind = key.slice(0, separator);
  const readableId = key.slice(separator + 1);
  return kind === 'entity' &&
    readableId.length > 0 &&
    readableId.length <= MAX_HYPERMEDIA_READABLE_ID_LENGTH &&
    HYPERMEDIA_READABLE_ID_PATTERN.test(readableId)
    ? { kind, readableId }
    : undefined;
}

export function selectedHypermediaResources(value: unknown): HypermediaResourceReference[] {
  if (typeof value !== 'string') {
    return [];
  }
  const resources = new Map<string, HypermediaResourceReference>();
  for (const key of value.split(',')) {
    const resource = resourceReferenceFromKey(key);
    if (resource) {
      resources.set(hypermediaResourceKey(resource), resource);
    }
    if (resources.size === MAX_SELECTED_HYPERMEDIA_RESOURCES) {
      break;
    }
  }
  return [...resources.values()];
}

export function selectedHypermediaResourcesValue(
  resources: HypermediaResourceReference[],
): string | undefined {
  return resources.length > 0 ? resources.map(hypermediaResourceKey).join(',') : undefined;
}

export function selectedHypermediaResourcesLabel(resources: HypermediaResourceReference[]): string {
  return `${resources.length} ${resources.length === 1 ? 'entity' : 'entities'} selected`;
}

export function toggleHypermediaResourceSelection({
  resources,
  selection,
}: {
  resources: HypermediaResourceReference[];
  selection: HypermediaSelection;
}): HypermediaResourceReference[] {
  if (selection.kind === 'page') {
    return resources;
  }
  const resource = { kind: selection.kind, readableId: selection.readableId };
  const key = hypermediaResourceKey(resource);
  if (resources.some((item) => hypermediaResourceKey(item) === key)) {
    return resources.filter((item) => hypermediaResourceKey(item) !== key);
  }
  return resources.length === MAX_SELECTED_HYPERMEDIA_RESOURCES
    ? resources
    : [...resources, resource];
}

export function removeHypermediaResourceSelection({
  resources,
  selection,
}: {
  resources: HypermediaResourceReference[];
  selection: HypermediaSelection;
}): HypermediaResourceReference[] {
  if (selection.kind === 'page') {
    return resources;
  }
  const key = hypermediaSelectionKey(selection);
  return resources.filter((resource) => hypermediaResourceKey(resource) !== key);
}
