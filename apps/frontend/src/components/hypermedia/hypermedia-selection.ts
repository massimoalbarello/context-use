import type { HypermediaResourceReference } from '../../queries/hypermedia';
import { hypermediaResourceKey } from '../../queries/hypermedia';
import type { HypermediaSelection } from './hypermedia-canvas';

export const MAX_SELECTED_HYPERMEDIA_RESOURCES = 24;
const MAX_HYPERMEDIA_READABLE_ID_LENGTH = 120;
const HYPERMEDIA_READABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function resourceReferenceFromKey(key: string): HypermediaResourceReference | undefined {
  const separator = key.indexOf(':');
  const kind = key.slice(0, separator);
  const readableId = key.slice(separator + 1);
  return (kind === 'entity' || kind === 'asset') &&
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
  const entityCount = resources.filter(({ kind }) => kind === 'entity').length;
  const assetCount = resources.length - entityCount;
  if (assetCount === 0) {
    return `${entityCount} ${entityCount === 1 ? 'entity' : 'entities'} selected`;
  }
  if (entityCount === 0) {
    return `${assetCount} ${assetCount === 1 ? 'asset' : 'assets'} selected`;
  }
  return `${resources.length} resources selected`;
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
