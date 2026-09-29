import { expect, test } from 'bun:test';
import { Elysia, StatusMap } from 'elysia';
import { createAuth } from '#backend/lib/auth/better-auth.ts';
import { createOwnerAuth } from '#backend/lib/auth/owner-auth.ts';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { KnowledgeProfilesRepository } from '#backend/repositories/knowledge-profiles/repository.ts';
import { OwnerRegistrationRepository } from '#backend/repositories/owner-registration/repository.ts';
import { createAuthController } from '#backend/routes/api/auth/controller.ts';
import { createKnowledgeProfileController } from '#backend/routes/api/profile/controller.ts';
import { createEntryController } from '#backend/routes/controller.ts';
import { createPublicController } from '#backend/routes/public/controller.ts';
import { KnowledgeProfilesService } from '#backend/services/knowledge-profiles/service.ts';
import { OwnerRegistrationService } from '#backend/services/owner-registration/service.ts';
import { withAuthTestDatabase } from '../lib/auth/auth-test-database.ts';
import { unusedPublicResourcesService } from '../support/app.ts';
import { testPasskey } from '../support/test-passkey.ts';

const ORIGIN = 'http://localhost:3000';
const AUTH_FLOW_TIMEOUT_MS = 30_000;
const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

test(
  'entry routing and private access follow authoritative owner sessions while public URLs stay public',
  async () => {
    await withAuthTestDatabase({
      run: async (database) => {
        const rawAuth = createAuth({
          getMcpAuthorizationId: async () => null,
          database,
          baseUrl: new URL(ORIGIN),
          secret: 'test-secret-at-least-thirty-two-characters',
          fetchClientMetadataResource: async () => new Response(null, { status: 503 }),
        });
        const auth = createOwnerAuth(rawAuth);
        const profilesService = new KnowledgeProfilesService(
          new KnowledgeProfilesRepository(database),
        );
        const ownerRegistrationService = new OwnerRegistrationService(
          new OwnerRegistrationRepository(database),
        );
        const app = new Elysia()
          .onError(elysiaErrorHandler)
          .use(createEntryController({ auth, ownerRegistrationService }))
          .use(
            createPublicController({
              ownerId: OWNER_USER_ID,
              publicOrigin: ORIGIN,
              publicResourcesService: {
                ...unusedPublicResourcesService,
                homepageContent: async () => null,
              },
            }),
          )
          .group('/api', (app) =>
            app
              .use(createAuthController({ auth }))
              .use(createKnowledgeProfileController({ auth, profilesService })),
          );
        const request = ({
          path,
          cookie = '',
          body,
        }: {
          path: string;
          cookie?: string;
          body?: unknown;
        }) =>
          app.handle(
            new Request(`${ORIGIN}${path}`, {
              method: body === undefined ? 'GET' : 'POST',
              headers: {
                origin: ORIGIN,
                cookie,
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
              },
              body: body === undefined ? undefined : JSON.stringify(body),
            }),
          );
        async function expectDestination({
          destination,
          cookie = '',
        }: {
          destination: string;
          cookie?: string;
        }) {
          const response = await request({ path: '/', cookie: cookie });
          expect(response.status).toBe(StatusMap.Found);
          expect(response.headers.get('location')).toBe(destination);
          expect(response.headers.get('cache-control')).toBe('private, no-store');
        }
        async function expectDenied(cookie = '') {
          const response = await request({ path: '/api/profile', cookie: cookie });
          expect(response.status).toBe(StatusMap.Unauthorized);
          expect(await response.json()).toEqual({ error: 'Unauthorized' });
          const write = await request({
            path: '/api/profile',
            cookie: cookie,
            body: {
              name: 'Unauthorized replacement',
              description: 'Should never be saved',
              changeMessage: 'Attempted write',
            },
          });
          expect(write.status).toBe(StatusMap.Unauthorized);
        }
        await expectDestination({ destination: '/app/login' });
        await expectDenied();
        const ownerPasskey = testPasskey('localhost');
        const options = await request({ path: '/api/auth/passkey/generate-register-options' });
        expect(options.status).toBe(StatusMap.OK);
        const { challenge } = await options.json();
        const registration = await request({
          path: '/api/auth/passkey/verify-registration',
          cookie: cookieHeader(options),
          body: {
            response: ownerPasskey.registration({ origin: ORIGIN, challenge }),
            createSession: true,
          },
        });
        expect(registration.status).toBe(StatusMap.OK);
        const ownerCookie = cookieHeader(registration);
        expect(
          await auth.getSession({ headers: new Headers({ cookie: ownerCookie }) }),
        ).not.toBeNull();
        await expectDestination({ destination: '/app', cookie: ownerCookie });
        const created = await request({
          path: '/api/profile',
          cookie: ownerCookie,
          body: {
            name: 'Private owner',
            description: 'Private owner description',
            changeMessage: 'Create owner profile',
          },
        });
        expect(created.status).toBe(StatusMap.Created);
        expect((await request({ path: '/api/profile', cookie: ownerCookie })).status).toBe(
          StatusMap.OK,
        );

        // A real foreign session must be rejected, even if another account somehow exists.
        const foreignId = 'foreign-user';
        const foreignPasskey = testPasskey('localhost');
        const now = new Date().toISOString();
        await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${foreignId}, 'Foreign', 'foreign@example.invalid', 1, ${now}, ${now})`;
        await database`insert into "auth_passkey" ("id", "userId", "credentialID", "publicKey", "counter", "deviceType", "backedUp") values ('foreign-key', ${foreignId}, ${foreignPasskey.id}, ${foreignPasskey.publicKey}, 0, 'singleDevice', 0)`;
        const foreignOptions = await request({
          path: '/api/auth/passkey/generate-authenticate-options',
        });
        const foreignChallenge = (await foreignOptions.json()).challenge;
        const foreignLogin = await request({
          path: '/api/auth/passkey/verify-authentication',
          cookie: cookieHeader(foreignOptions),
          body: {
            response: foreignPasskey.authentication({
              origin: ORIGIN,
              challenge: foreignChallenge,
            }),
          },
        });
        expect(foreignLogin.status).toBe(StatusMap.OK);
        const foreignCookie = cookieHeader(foreignLogin);
        expect(
          (await rawAuth.getSession({ headers: new Headers({ cookie: foreignCookie }) }))?.user.id,
        ).toBe(foreignId);
        for (const cookie of ['', 'better-auth.session_token=forged', foreignCookie]) {
          await expectDestination({ destination: '/public', cookie: cookie });
          await expectDenied(cookie);
        }
        for (const cookie of ['', ownerCookie, foreignCookie]) {
          for (const path of ['/public', '/public/']) {
            const response = await request({ path: path, cookie: cookie });
            expect(response.status).toBe(StatusMap.OK);
            expect(response.headers.get('location')).toBeNull();
            const html = await response.text();
            expect(html).toContain('Owner dashboard');
            expect(html).not.toContain('Private owner description');
          }
        }
        // Once claimed, anonymous registration cannot add a passkey or replace the owner.
        const secondRegistration = await request({
          path: '/api/auth/passkey/generate-register-options',
        });
        expect(secondRegistration.ok).toBe(false);
        expect(
          await database`select "id" from "auth_passkey" where "userId" = ${OWNER_USER_ID}`,
        ).toHaveLength(1);
        expect(await profilesService.find({ ownerId: OWNER_USER_ID })).toMatchObject({
          selfEntity: { name: 'Private owner', description: 'Private owner description' },
        });
        expect(await profilesService.find({ ownerId: foreignId })).toBeNull();

        await database`update "auth_session" set "expiresAt" = '2000-01-01T00:00:00.000Z' where "userId" = ${OWNER_USER_ID}`;
        await expectDestination({ destination: '/public', cookie: ownerCookie });
        await expectDenied(ownerCookie);
        const loginOptions = await request({
          path: '/api/auth/passkey/generate-authenticate-options',
        });
        const login = await request({
          path: '/api/auth/passkey/verify-authentication',
          cookie: cookieHeader(loginOptions),
          body: {
            response: ownerPasskey.authentication({
              origin: ORIGIN,
              challenge: (await loginOptions.json()).challenge,
            }),
          },
        });
        expect(login.status).toBe(StatusMap.OK);
        const renewedCookie = cookieHeader(login);
        await expectDestination({ destination: '/app', cookie: renewedCookie });
        await database`delete from "auth_session" where "userId" = ${OWNER_USER_ID}`;
        await expectDestination({ destination: '/public', cookie: renewedCookie });
        await expectDenied(renewedCookie);

        // Losing the last passkey must fail closed, never reopen first-owner registration.
        await database`delete from "auth_passkey" where "userId" = ${OWNER_USER_ID}`;
        const brokenRegistration = await request({ path: '/' });
        expect(brokenRegistration.status).toBe(StatusMap['Internal Server Error']);
        expect(brokenRegistration.headers.get('location')).toBeNull();
        expect(brokenRegistration.headers.get('cache-control')).toBe('private, no-store');
      },
    });
  },
  AUTH_FLOW_TIMEOUT_MS,
);
