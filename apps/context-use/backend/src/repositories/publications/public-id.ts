export function createPublicId(resourceType: 'page' | 'entity' | 'asset'): string {
  return `${resourceType}_${crypto.randomUUID()}`;
}
