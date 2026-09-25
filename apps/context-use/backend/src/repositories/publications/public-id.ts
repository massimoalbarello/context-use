export function createPublicId(resourceType: 'page' | 'entity' | 'asset' | 'record'): string {
  return `${resourceType}_${crypto.randomUUID()}`;
}
