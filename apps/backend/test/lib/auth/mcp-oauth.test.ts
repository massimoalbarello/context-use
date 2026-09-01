import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createMcpProtectedRequestHandler } from '@better-auth/mcp';
import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';
import {
  createAuth,
  createAuthOptions,
  MCP_SCOPE,
  type McpAccessToken,
} from '#lib/auth/better-auth.ts';
import {
  OWNER_DISPLAY_NAME,
  OWNER_SYNTHETIC_EMAIL,
  OWNER_USER_ID,
} from '#lib/auth/owner-registration.ts';
import { McpClientAuthorizationsRepository } from '#repositories/mcp-client-authorizations/repository.ts';
import { createAuthDiscoveryController } from '#routes/auth-discovery/controller.ts';
import { McpClientAuthorizationsService } from '#services/mcp-client-authorizations/service.ts';
import { withAuthTestDatabase } from './auth-test-database.ts';

const TEST_SECRET = 'test-secret-at-least-thirty-two-characters';
const CALLBACK_URL = 'http://127.0.0.1/callback';
const ACCESS_TOKEN_LIFETIME_SECONDS = 300;
const HTTP_BAD_REQUEST = 400;
const HTTP_CREATED = 201;
const HTTP_FOUND = 302;
const HTTP_NO_CONTENT = 204;
const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_UNAUTHORIZED = 401;

type OAuthTestUrls = {
  origin: string;
  authBase: string;
  mcpResource: string;
};

type OAuthClientRegistration = {
  client_id: string;
};

type OAuthTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
};

type TestAuthContext = Awaited<ReturnType<typeof betterAuth>['$context']> & {
  test: {
    createUser(overrides: Record<string, unknown>): {
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
      createdAt: Date;
      updatedAt: Date;
    };
    saveUser(user: Record<string, unknown>): Promise<unknown>;
    login(input: { userId: string }): Promise<{ headers: Headers }>;
  };
};

function jsonRequest({
  url,
  origin,
  body,
  headers,
}: {
  url: string;
  origin: string;
  body: unknown;
  headers?: Headers;
}) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('content-type', 'application/json');
  requestHeaders.set('origin', origin);
  return new Request(url, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

function formRequest({ url, body }: { url: string; body: Record<string, string> }) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Expected success, received ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) {
    throw new Error('Expected a JWT access token.');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function registerClient({
  handler,
  name,
  urls,
}: {
  handler: (request: Request) => Promise<Response>;
  name: string;
  urls: OAuthTestUrls;
}): Promise<OAuthClientRegistration> {
  const response = await handler(
    jsonRequest({
      url: `${urls.authBase}/oauth2/register`,
      origin: urls.origin,
      body: {
        client_name: name,
        application_type: 'native',
        redirect_uris: [CALLBACK_URL],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: `${MCP_SCOPE} offline_access`,
      },
    }),
  );
  const registration = await responseJson<OAuthClientRegistration>(response);
  expect(response.status).toBe(HTTP_CREATED);
  return registration;
}

async function authorizeClient({
  handler,
  sessionHeaders,
  clientId,
  urls,
}: {
  handler: (request: Request) => Promise<Response>;
  sessionHeaders: Headers;
  clientId: string;
  urls: OAuthTestUrls;
}): Promise<string> {
  const verifier = 'oauth-test-code-verifier-with-more-than-forty-three-characters';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorizeUrl = new URL(`${urls.authBase}/oauth2/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK_URL,
    scope: `${MCP_SCOPE} offline_access`,
    state: 'test-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: urls.mcpResource,
  }).toString();
  const authorizeHeaders = new Headers(sessionHeaders);
  authorizeHeaders.set('accept', 'text/html');
  const authorization = await handler(
    new Request(authorizeUrl.href, { headers: authorizeHeaders }),
  );
  expect(authorization.status).toBe(HTTP_FOUND);
  const approvalLocation = authorization.headers.get('location');
  expect(approvalLocation).toStartWith('/mcp/authorize?');

  const oauthQuery = new URL(approvalLocation!, urls.origin).search.slice(1);
  const consent = await handler(
    jsonRequest({
      url: `${urls.authBase}/oauth2/consent`,
      origin: urls.origin,
      headers: sessionHeaders,
      body: { accept: true, oauth_query: oauthQuery },
    }),
  );
  const { url: redirectUri } = await responseJson<{ redirect: true; url: string }>(consent);
  const callback = new URL(redirectUri);
  expect(callback.searchParams.get('state')).toBe('test-state');
  const code = callback.searchParams.get('code');
  if (!code) {
    throw new Error(`Authorization did not return a code: ${redirectUri}`);
  }

  const token = await handler(
    formRequest({
      url: `${urls.authBase}/oauth2/token`,
      body: {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: CALLBACK_URL,
        resource: urls.mcpResource,
      },
    }),
  );
  return JSON.stringify(await responseJson<OAuthTokenResponse>(token));
}

async function refreshClient({
  handler,
  clientId,
  refreshToken,
  urls,
  resource = urls.mcpResource,
}: {
  handler: (request: Request) => Promise<Response>;
  clientId: string;
  refreshToken: string;
  urls: OAuthTestUrls;
  resource?: string;
}): Promise<Response> {
  return await handler(
    formRequest({
      url: `${urls.authBase}/oauth2/token`,
      body: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
        resource,
      },
    }),
  );
}

describe('MCP OAuth foundation', () => {
  test('issues resource-bound short access tokens and rotates durable refresh credentials', async () => {
    await withAuthTestDatabase({
      run: async (database) => {
        let oauthHandler: (request: Request) => Promise<Response> = async (_request) =>
          new Response(null, { status: HTTP_SERVICE_UNAVAILABLE });
        const authorizationServer = Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          fetch: (request) => oauthHandler(request),
        });
        const origin = authorizationServer.url.origin;
        const urls: OAuthTestUrls = {
          origin,
          authBase: `${origin}/api/auth`,
          mcpResource: `${origin}/mcp`,
        };
        const options = createAuthOptions({
          database,
          baseUrl: new URL(origin),
          secret: TEST_SECRET,
          fetchClientMetadataResource: async () => new Response(null, { status: 503 }),
        });
        const oauth = betterAuth({
          ...options,
          plugins: [...(options.plugins ?? []), testUtils()],
        });
        oauthHandler = (request) => oauth.handler(request);
        try {
          const context = (await oauth.$context) as unknown as TestAuthContext;
          await context.test.saveUser(
            context.test.createUser({
              id: OWNER_USER_ID,
              name: OWNER_DISPLAY_NAME,
              email: OWNER_SYNTHETIC_EMAIL,
              emailVerified: true,
            }),
          );
          const { headers: sessionHeaders } = await context.test.login({ userId: OWNER_USER_ID });
          const discovery = createAuthDiscoveryController({
            auth: {
              handler: oauth.handler,
              getSession: async () => null,
              protectMcpRequest: () => async () =>
                new Response(null, { status: HTTP_SERVICE_UNAVAILABLE }),
            },
          });
          const resourceMetadataResponse = await discovery.handle(
            new Request(`${origin}/.well-known/oauth-protected-resource/mcp`),
          );
          expect(resourceMetadataResponse.status).toBe(HTTP_OK);
          expect(await resourceMetadataResponse.json()).toMatchObject({
            resource: urls.mcpResource,
            authorization_servers: [urls.authBase],
            scopes_supported: [MCP_SCOPE],
          });
          const authorizationMetadataResponse = await discovery.handle(
            new Request(`${origin}/.well-known/oauth-authorization-server/api/auth`),
          );
          expect(authorizationMetadataResponse.status).toBe(HTTP_OK);
          expect(await authorizationMetadataResponse.json()).toMatchObject({
            issuer: urls.authBase,
            authorization_endpoint: `${urls.authBase}/oauth2/authorize`,
            token_endpoint: `${urls.authBase}/oauth2/token`,
            registration_endpoint: `${urls.authBase}/oauth2/register`,
          });
          const client = await registerClient({
            handler: oauth.handler,
            name: 'Desktop Agent',
            urls,
          });
          const clientAuthorizations = new McpClientAuthorizationsService(
            new McpClientAuthorizationsRepository(database),
          );
          const approval = await clientAuthorizations.approve({
            actorId: OWNER_USER_ID,
            clientId: client.client_id,
            name: 'My coding agent',
          });
          expect(approval.state).toBe('approved');

          const initial = JSON.parse(
            await authorizeClient({
              handler: oauth.handler,
              sessionHeaders,
              clientId: client.client_id,
              urls,
            }),
          ) as OAuthTokenResponse;
          expect(initial.expires_in).toBe(ACCESS_TOKEN_LIFETIME_SECONDS);
          expect(initial.scope.split(' ').sort()).toEqual([MCP_SCOPE, 'offline_access'].sort());
          expect(initial.refresh_token).toBeString();

          const claims = decodeJwt(initial.access_token);
          expect(claims).toMatchObject({
            iss: urls.authBase,
            aud: urls.mcpResource,
            sub: OWNER_USER_ID,
            client_id: client.client_id,
          });
          expect(Number(claims.exp) - Number(claims.iat)).toBe(ACCESS_TOKEN_LIFETIME_SECONDS);

          const resourceServerAuth = createAuth({
            database,
            baseUrl: new URL(origin),
            secret: TEST_SECRET,
            fetchClientMetadataResource: async () => new Response(null, { status: 503 }),
          });
          let authenticatedToken: McpAccessToken | undefined;
          const protectedHandler = resourceServerAuth.protectMcpRequest({
            handler: ({ token }) => {
              authenticatedToken = token;
              return Promise.resolve(new Response(null, { status: HTTP_NO_CONTENT }));
            },
          });
          const accepted = await protectedHandler(
            new Request('https://internal-proxy.invalid/mcp', {
              method: 'POST',
              headers: { authorization: `Bearer ${initial.access_token}` },
            }),
          );
          if (accepted.status !== HTTP_NO_CONTENT) {
            throw new Error(
              `Expected protected token acceptance, received ${accepted.status}: ${await accepted.text()}`,
            );
          }
          expect(accepted.status).toBe(HTTP_NO_CONTENT);
          expect(authenticatedToken).toMatchObject({
            ownerId: OWNER_USER_ID,
            oauthClientId: client.client_id,
            scopes: expect.arrayContaining([MCP_SCOPE]),
          });
          expect(authenticatedToken?.resource.href).toBe(urls.mcpResource);

          const mismatchedIssuer = createMcpProtectedRequestHandler(
            {
              issuer: `${origin}/wrong-issuer`,
              audience: urls.mcpResource,
              jwksUrl: `${urls.authBase}/jwks`,
            },
            async () => new Response(null, { status: HTTP_NO_CONTENT }),
          );
          expect(
            (
              await mismatchedIssuer(
                new Request(urls.mcpResource, {
                  headers: { authorization: `Bearer ${initial.access_token}` },
                }),
              )
            ).status,
          ).toBe(HTTP_UNAUTHORIZED);
          const mismatchedAudience = createMcpProtectedRequestHandler(
            {
              issuer: urls.authBase,
              audience: `${origin}/another-resource`,
              jwksUrl: `${urls.authBase}/jwks`,
            },
            async () => new Response(null, { status: HTTP_NO_CONTENT }),
          );
          expect(
            (
              await mismatchedAudience(
                new Request(`${origin}/another-resource`, {
                  headers: { authorization: `Bearer ${initial.access_token}` },
                }),
              )
            ).status,
          ).toBe(HTTP_UNAUTHORIZED);

          const cookieOnly = await protectedHandler(
            new Request(urls.mcpResource, { method: 'POST', headers: sessionHeaders }),
          );
          expect(cookieOnly.status).toBe(HTTP_UNAUTHORIZED);

          const wrongResource = await refreshClient({
            handler: oauth.handler,
            clientId: client.client_id,
            refreshToken: initial.refresh_token,
            urls,
            resource: `${origin}/another-resource`,
          });
          expect(wrongResource.status).toBe(HTTP_BAD_REQUEST);
          expect(await wrongResource.json()).toMatchObject({ error: 'invalid_target' });

          const refreshedResponse = await refreshClient({
            handler: oauth.handler,
            clientId: client.client_id,
            refreshToken: initial.refresh_token,
            urls,
          });
          const refreshed = await responseJson<OAuthTokenResponse>(refreshedResponse);
          expect(refreshed.refresh_token).not.toBe(initial.refresh_token);
          expect(refreshed.access_token).not.toBe(initial.access_token);

          const stored = await database<{ token: string }[]>`
          select "token" from "auth_oauthRefreshToken" where "clientId" = ${client.client_id}
        `;
          expect(stored.every(({ token }) => token !== initial.refresh_token)).toBeTrue();
          expect(stored.every(({ token }) => token !== refreshed.refresh_token)).toBeTrue();

          const retriedResponse = await refreshClient({
            handler: oauth.handler,
            clientId: client.client_id,
            refreshToken: initial.refresh_token,
            urls,
          });
          const retried = await responseJson<OAuthTokenResponse>(retriedResponse);
          expect(retried.refresh_token).toBe(refreshed.refresh_token);

          const archivedClient = await registerClient({
            handler: oauth.handler,
            name: 'Another desktop agent',
            urls,
          });
          const archivedApproval = await clientAuthorizations.approve({
            actorId: OWNER_USER_ID,
            clientId: archivedClient.client_id,
            name: 'My coding agent',
          });
          expect(archivedApproval.state).toBe('approved');
          if (archivedApproval.state !== 'approved') {
            throw new Error('Expected approval for the client to archive');
          }
          const archivedTokens = JSON.parse(
            await authorizeClient({
              handler: oauth.handler,
              sessionHeaders,
              clientId: archivedClient.client_id,
              urls,
            }),
          ) as OAuthTokenResponse;
          expect(
            await clientAuthorizations.archive({
              actorId: OWNER_USER_ID,
              clientAuthorizationId: archivedApproval.clientAuthorization.id,
            }),
          ).toEqual({ state: 'archived' });
          expect(
            await clientAuthorizations.authenticate({
              ownerId: OWNER_USER_ID,
              oauthClientId: archivedClient.client_id,
            }),
          ).toBeNull();
          const archivedRefresh = await refreshClient({
            handler: oauth.handler,
            clientId: archivedClient.client_id,
            refreshToken: archivedTokens.refresh_token,
            urls,
          });
          expect(archivedRefresh.status).toBe(HTTP_BAD_REQUEST);
          expect(await archivedRefresh.json()).toMatchObject({ error: 'invalid_grant' });

          await database`
          update "auth_oauthRefreshToken"
          set "rotationReplayExpiresAt" = ${new Date(0).toISOString()}
          where "clientId" = ${client.client_id} and "rotatedAt" is not null
        `;
          const replayed = await refreshClient({
            handler: oauth.handler,
            clientId: client.client_id,
            refreshToken: initial.refresh_token,
            urls,
          });
          expect(replayed.status).toBe(HTTP_BAD_REQUEST);
          expect(await replayed.json()).toMatchObject({ error: 'invalid_grant' });

          const familyInvalidated = await refreshClient({
            handler: oauth.handler,
            clientId: client.client_id,
            refreshToken: refreshed.refresh_token,
            urls,
          });
          expect(familyInvalidated.status).toBe(HTTP_BAD_REQUEST);
          expect(await familyInvalidated.json()).toMatchObject({ error: 'invalid_grant' });
        } finally {
          await authorizationServer.stop(true);
        }
      },
    });
  });
});
