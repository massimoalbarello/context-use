export const MAX_API_KEY_NAME_LENGTH = 160;

export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type ApiKey = {
  readableId: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
};

export type ApiKeyPrincipal = {
  keyId: string;
  ownerId: string;
};

export function normalizeApiKeyName(value: string): string | null {
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_API_KEY_NAME_LENGTH ? name : null;
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}
