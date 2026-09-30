import { expect, test } from 'bun:test';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { createManagedSyncsController } from '#backend/routes/api/syncs/managed/controller.ts';
import { createSyncCallbacks } from '#backend/routes/sync-callbacks.ts';
import type { ManagedSyncsServiceContract } from '#backend/services/syncs/managed.ts';
import { unusedMcpProtection } from '../../support/mcp.ts';

function auth(): Auth {
  const now = new Date();
  return {
    passkeyOrigins: ['http://host'],
    protectMcpRequest: unusedMcpProtection,
    handler: () => Promise.resolve(new Response(null)),
    getSession: ({ headers }) =>
      Promise.resolve(
        headers.get('cookie') === 'owner-session'
          ? {
              user: {
                id: OWNER_USER_ID,
                name: 'Owner',
                email: OWNER_SYNTHETIC_EMAIL,
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
              },
              session: {
                id: 'session',
                userId: OWNER_USER_ID,
                token: 'token',
                expiresAt: now,
                createdAt: now,
                updatedAt: now,
              },
            }
          : null,
      ),
  };
}

test('management rejects unauthenticated and cross-origin mutations; OAuth completion remains owner-bound', async () => {
  const completed: string[] = [];
  const configured: string[] = [];
  const services: ManagedSyncsServiceContract = {
    list: () => Promise.resolve([]),
    configureApp: ({ actorId }) => {
      configured.push(actorId);
      return Promise.resolve();
    },
    connect: () => Promise.resolve({ authorizationUrl: null }),
    update: () => Promise.resolve(),
    completeConnection: ({ actorId }) => {
      completed.push(actorId);
      return Promise.resolve();
    },
  };
  const authentication = auth();
  const app = new Elysia()
    .onError(elysiaErrorHandler)
    .use(
      new Elysia({ prefix: '/api' }).use(
        createManagedSyncsController({ auth: authentication, syncs: services }),
      ),
    )
    .use(
      createSyncCallbacks({
        auth: authentication,
        syncs: services,
        fetch: () =>
          Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: '/syncs/github?tab=authorization&authorization=connected' },
            }),
          ),
      }),
    );
  expect((await app.handle(new Request('http://host/api/syncs/managed'))).status).toBe(
    StatusMap.Unauthorized,
  );
  const post = (origin: string) =>
    app.handle(
      new Request('http://host/api/syncs/managed/providers/github/connect', {
        method: 'POST',
        headers: { cookie: 'owner-session', origin, 'content-type': 'application/json' },
        body: JSON.stringify({ changeMessage: 'Connect GitHub sync' }),
      }),
    );
  expect((await post('http://attacker')).status).toBe(StatusMap.Forbidden);
  expect((await post('http://host')).status).toBe(StatusMap.OK);
  const saveApp = ({
    origin,
    cookie,
    body = { actorId: 'untrusted-body-actor', clientId: 'client', clientSecret: 'secret' },
  }: {
    origin: string;
    cookie?: string;
    body?: Record<string, unknown>;
  }) =>
    app.handle(
      new Request('http://host/api/syncs/managed/providers/github/app', {
        method: 'POST',
        headers: { origin, ...(cookie ? { cookie } : {}), 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, changeMessage: 'Configure provider credentials' }),
      }),
    );
  expect((await saveApp({ origin: 'http://host' })).status).toBe(StatusMap.Unauthorized);
  expect((await saveApp({ origin: 'http://attacker', cookie: 'owner-session' })).status).toBe(
    StatusMap.Forbidden,
  );
  expect(configured).toEqual([]);
  const saved = await saveApp({ origin: 'http://host', cookie: 'owner-session' });
  expect(saved.status).toBe(StatusMap.OK);
  expect(await saved.text()).not.toContain('secret');
  expect(configured).toEqual([OWNER_USER_ID]);
  for (const body of [
    { clientId: 'client', clientSecret: 'private-secret with spaces' },
    { clientId: ' ', clientSecret: 'private-secret' },
    { clientSecret: 'private-secret' },
    { clientId: 'client', clientSecret: { value: 'private-secret' } },
  ]) {
    const invalidApp = await saveApp({ origin: 'http://host', cookie: 'owner-session', body });
    expect(invalidApp.status).toBe(StatusMap['Bad Request']);
    expect(await invalidApp.text()).not.toContain('private-secret');
  }
  expect(configured).toEqual([OWNER_USER_ID]);

  const callback =
    'http://host/api/open-sync/providers/github/return/connection_00000000-0000-0000-0000-000000000000';
  expect((await app.handle(new Request(callback))).status).toBe(StatusMap.Unauthorized);
  expect(completed).toEqual([]);
  const result = await app.handle(new Request(callback, { headers: { cookie: 'owner-session' } }));
  expect(result.status).toBe(StatusMap.Found);
  expect(completed).toEqual([OWNER_USER_ID]);
  expect(
    (
      await app.handle(
        new Request('http://host/api/open-sync/providers/connections', {
          headers: { cookie: 'owner-session' },
        }),
      )
    ).status,
  ).toBe(StatusMap['Not Found']);
});
