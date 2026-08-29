export const MAX_READABLE_ID_LENGTH = 120;
export const READABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isReadableId(value: string): boolean {
  return value.length <= MAX_READABLE_ID_LENGTH && READABLE_ID_PATTERN.test(value);
}

export function readableIdFrom(value: string): string | null {
  const readableId = value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_READABLE_ID_LENGTH)
    .replace(/-+$/g, '');

  return readableId || null;
}
