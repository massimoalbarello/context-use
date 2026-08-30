export const MAX_READABLE_ID_LENGTH = 120;
export const READABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const READABLE_ID_SUFFIX_LENGTH = 6;

const CODE_POINT_RADIX = 16;

export function isReadableId(value: string): boolean {
  return value.length <= MAX_READABLE_ID_LENGTH && READABLE_ID_PATTERN.test(value);
}

function encodedReadableIdFrom(value: string): string {
  return `u-${[...value.normalize('NFKC').trim()]
    .map((character) => character.codePointAt(0)?.toString(CODE_POINT_RADIX))
    .filter((codePoint): codePoint is string => Boolean(codePoint))
    .join('-')}`
    .slice(0, MAX_READABLE_ID_LENGTH)
    .replace(/-+$/g, '');
}

export function readableIdFrom(value: string): string {
  const readableId = value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_READABLE_ID_LENGTH)
    .replace(/-+$/g, '');

  return readableId || encodedReadableIdFrom(value);
}

export function readableIdWithSuffix({
  readableId,
  suffix,
}: {
  readableId: string;
  suffix: string;
}): string {
  const baseLength = MAX_READABLE_ID_LENGTH - suffix.length - 1;
  const base = readableId.slice(0, baseLength).replace(/-+$/g, '');
  return `${base}-${suffix}`;
}
