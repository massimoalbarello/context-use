import { Elysia, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { UnauthorizedError } from '#backend/lib/errors.ts';
import type { ManagedSyncsServiceContract } from '#backend/services/syncs/managed.ts';

export type SyncFetch = (request: Request) => Promise<Response>;
export function createSyncCallbacks(input: {
  auth: Auth;
  fetch: SyncFetch;
  syncs: ManagedSyncsServiceContract;
}) {
  return new Elysia()
    .get('/api/open-sync/oauth/callback', ({ request }) => input.fetch(request))
    .get(
      '/api/open-sync/providers/:providerId/return/:id',
      async ({ request, params }) => {
        const session = await input.auth.getSession({ headers: request.headers });
        if (session?.user.id !== OWNER_USER_ID) {
          throw new UnauthorizedError();
        }
        const response = await input.fetch(request);
        if (
          response.headers.get('location') ===
          syncProviderLocation({ providerId: params.providerId, outcome: 'connected' })
        ) {
          try {
            await input.syncs.completeConnection({
              actorId: session.user.id,
              providerId: params.providerId,
            });
          } catch {
            return Response.redirect(
              new URL(
                syncProviderLocation({ providerId: params.providerId, outcome: 'failed' }),
                request.url,
              ),
            );
          }
        }
        return response;
      },
      {
        params: t.Object({
          providerId: t.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
          id: t.String({ pattern: '^connection_[a-f0-9-]{36}$' }),
        }),
      },
    );
}

export function syncProviderLocation(input: {
  providerId: string;
  outcome: 'connected' | 'failed';
}) {
  return `/syncs/${encodeURIComponent(input.providerId)}?tab=authorization&authorization=${input.outcome}`;
}
