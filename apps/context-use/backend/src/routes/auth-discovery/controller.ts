import { Elysia, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';

export function createAuthDiscoveryController({ auth }: { auth: Auth }) {
  return (
    new Elysia()
      .get(
        '/.well-known/webauthn',
        ({ set }) => {
          set.headers['cache-control'] = 'no-store';
          return { origins: auth.passkeyOrigins };
        },
        {
          response: t.Object({ origins: t.Array(t.String()) }),
          detail: { hide: true },
        },
      )
      // Better Auth owns OAuth discovery, but its ordinary handler is mounted below /api/auth.
      .all('/.well-known/*', ({ request }) => auth.handler(request), {
        parse: 'none',
        detail: { hide: true },
      })
  );
}
