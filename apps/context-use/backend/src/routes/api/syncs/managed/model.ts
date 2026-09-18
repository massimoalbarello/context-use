import { t } from 'elysia';
import { MANAGED_SYNC_STATES } from '#backend/models/syncs/managed.ts';

export const ProviderParamsSchema = t.Object({
  providerId: t.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
});
export const ManagedSyncListSchema = t.Array(
  t.Object({
    id: t.String(),
    name: t.String(),
    description: t.String(),
    oauthApp: t.Object({
      configured: t.Boolean(),
      clientId: t.Nullable(t.String()),
      callbackUrl: t.String(),
      createAppUrl: t.String(),
    }),
    account: t.Object({
      name: t.Nullable(t.String()),
      status: t.UnionEnum(['disconnected', 'connected', 'error']),
    }),
    syncs: t.Array(
      t.Object({
        key: t.String(),
        name: t.String(),
        description: t.String(),
        provider: t.String(),
        kinds: t.Array(t.String()),
        intervalMs: t.Integer(),
        state: t.UnionEnum(MANAGED_SYNC_STATES),
        recordCount: t.Integer(),
        lastSyncedAt: t.Nullable(t.String()),
        nextSyncAt: t.Nullable(t.String()),
        message: t.String(),
      }),
    ),
  }),
);
const oauthAppValidationError = 'Check your OAuth client ID and client secret.';
export const OAuthAppBodySchema = t.Object(
  {
    clientId: t.String({
      minLength: 1,
      maxLength: 256,
      pattern: '^\\S+$',
      error: oauthAppValidationError,
    }),
    clientSecret: t.String({
      minLength: 1,
      maxLength: 1024,
      pattern: '^\\S+$',
      error: oauthAppValidationError,
    }),
  },
  { error: oauthAppValidationError },
);
export const ActionBodySchema = t.Object({
  action: t.Union([t.Literal('pause'), t.Literal('resume'), t.Literal('run')]),
});
