import { expect, test } from 'bun:test';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { PublicSiteRepository } from '#backend/repositories/public-site/repository.ts';
import { createPublicSiteController } from '#backend/routes/api/public-site/controller.ts';
import { PublicSiteService } from '#backend/services/public-site/service.ts';
import { unusedMcpProtection } from '../../../support/mcp.ts';
import { withPublicResources } from '../../public/fixture.ts';

test('homepage settings require a session, validate selections, and use the authenticated owner', async () => {
  await withPublicResources(async ({ database, create, publish, transition }) => {
    const site = new PublicSiteRepository(database);
    const page = await create({ markdown: '# Owner homepage\n\nPublished content.' });
    const foreign = await create({
      ownerId: 'owner-b',
      markdown: '# Other homepage\n\nPublished content.',
    });
    await publish({ readableId: page.readableId });
    await transition({
      ownerId: 'owner-b',
      readableId: foreign.readableId,
      resourceType: 'page',
      action: 'publish',
      revisionNumber: 1,
    });
    const auth: Auth = {
      passkeyOrigins: [],
      handler: async () => new Response(null, { status: 404 }),
      protectMcpRequest: unusedMcpProtection,
      getSession: ({ headers }) => {
        const ownerId = headers.get('cookie') === 'test-owner=a' ? 'owner-a' : null;
        if (!ownerId) {
          return Promise.resolve(null);
        }
        const date = new Date('2026-09-25');
        return Promise.resolve({
          user: {
            id: ownerId,
            name: 'Owner',
            email: 'owner@example.invalid',
            emailVerified: true,
            createdAt: date,
            updatedAt: date,
          },
          session: {
            id: 'session-a',
            userId: ownerId,
            token: 'test-token',
            expiresAt: date,
            createdAt: date,
            updatedAt: date,
          },
        });
      },
    };
    const app = new Elysia().onError(elysiaErrorHandler).group('/api', (app) =>
      app.use(
        createPublicSiteController({
          auth,
          publicSiteService: new PublicSiteService(site),
        }),
      ),
    );
    const request = ({
      body,
      authenticated = true,
    }: {
      body?: unknown;
      authenticated?: boolean;
    } = {}) =>
      app.handle(
        new Request(`http://localhost/api/public-site${body === undefined ? '' : '/homepage'}`, {
          method: body === undefined ? 'GET' : 'PUT',
          headers: {
            'content-type': 'application/json',
            ...(authenticated ? { cookie: 'test-owner=a' } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    expect((await request({ authenticated: false })).status).toBe(StatusMap.Unauthorized);
    expect(
      (await request({ body: { readableId: page.readableId }, authenticated: false })).status,
    ).toBe(StatusMap.Unauthorized);
    expect(await (await request()).json()).toEqual({ homepage: null });
    expect((await request({ body: { readableId: page.readableId } })).status).toBe(StatusMap.OK);
    expect((await request({ body: { readableId: foreign.readableId } })).status).toBe(
      StatusMap['Not Found'],
    );
    expect((await request({ body: { readableId: 'missing' } })).status).toBe(
      StatusMap['Not Found'],
    );
    expect((await request({ body: { readableId: true } })).status).toBe(StatusMap['Bad Request']);
    expect((await site.homepage({ ownerId: 'owner-a' }))?.readableId).toBe(page.readableId);
    expect(await site.homepage({ ownerId: 'owner-b' })).toBeNull();
    const settings = await (await request()).json();
    expect(settings.homepage.title).toBe('Owner homepage');
    expect(settings.homepage).not.toHaveProperty('ownerId');
    expect((await request({ body: { readableId: null } })).status).toBe(StatusMap.OK);
    expect(await (await request()).json()).toEqual({ homepage: null });
  });
});
