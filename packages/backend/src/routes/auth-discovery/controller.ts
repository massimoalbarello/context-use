import { Elysia } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';

// Better Auth owns these protocol documents, but its ordinary handler is mounted below /api/auth.
// Forward root well-known discovery explicitly so remote MCP clients can find the resource and AS.
export function createAuthDiscoveryController({ auth }: { auth: Auth }) {
  return new Elysia().all('/.well-known/*', ({ request }) => auth.handler(request), {
    parse: 'none',
    detail: { hide: true },
  });
}
