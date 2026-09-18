import { t } from 'elysia';
import type { OpenAPIV3 } from 'openapi-types';
import type { ApiKey } from '#backend/models/api-keys/model.ts';
import { MAX_API_KEY_NAME_LENGTH, UUID_V7_PATTERN } from '#backend/models/api-keys/model.ts';
import { ReadableIdSchema } from '#backend/routes/api/model.ts';

export const ApiKeySchema = t.Object({
  readableId: ReadableIdSchema,
  name: t.String({ minLength: 1, maxLength: MAX_API_KEY_NAME_LENGTH }),
  createdAt: t.String(),
  revokedAt: t.Nullable(t.String()),
});

export const ApiKeyListSchema = t.Object({ items: t.Array(ApiKeySchema) });

export const CreateApiKeyBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: MAX_API_KEY_NAME_LENGTH }),
});

export const CreateApiKeyResponseSchema = t.Object({
  key: ApiKeySchema,
  apiKey: t.String({ pattern: UUID_V7_PATTERN.source }),
});

export const ApiKeyParamsSchema = t.Object({ keyReadableId: ReadableIdSchema });

export function apiKeyResponse(key: ApiKey) {
  return {
    readableId: key.readableId,
    name: key.name,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
  };
}

export const API_KEY_SECURITY_SCHEME = 'apiKeyBearer';
export const apiKeySecuritySchemes = {
  [API_KEY_SECURITY_SCHEME]: {
    type: 'http',
    scheme: 'bearer',
    description: 'API key issued by Context Use.',
  },
} satisfies Record<string, OpenAPIV3.SecuritySchemeObject>;
