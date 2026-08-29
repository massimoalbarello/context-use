export const MAX_READABLE_ID_LENGTH = 120;
export const READABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isReadableId(value: string): boolean {
  return value.length <= MAX_READABLE_ID_LENGTH && READABLE_ID_PATTERN.test(value);
}
