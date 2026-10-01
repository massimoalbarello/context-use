import { expect, test } from 'bun:test';
import { granolaClientRegistration } from '#backend/services/syncs/sources/granola-mcp/oauth.ts';

const issuer = 'https://mcp-auth.granola.ai';
const resource = 'https://mcp.granola.ai/mcp';
const input = {
  redirectUri: 'https://sync.example/api/open-sync/oauth/callback',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  signal: new AbortController().signal,
};

function fixture(options: { registrationEndpoint?: string; returnedRedirect?: string } = {}) {
  const requests: Request[] = [];
  const register = granolaClientRegistration({
    fetch: Object.assign(
      async (...[url, init]: Parameters<typeof fetch>) => {
        const request =
          url instanceof Request ? new Request(url, init) : new Request(String(url), init);
        requests.push(request);
        expect(request.redirect).toBe('error');
        if (request.url.startsWith('https://mcp.granola.ai/.well-known/oauth-protected-resource')) {
          return Response.json({ resource, authorization_servers: [issuer] });
        }
        if (request.url === `${issuer}/.well-known/oauth-authorization-server`) {
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}/oauth2/authorize`,
            token_endpoint: `${issuer}/oauth2/token`,
            registration_endpoint: options.registrationEndpoint ?? `${issuer}/oauth2/register`,
            response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
          });
        }
        expect(request.url).toBe(`${issuer}/oauth2/register`);
        expect(request.method).toBe('POST');
        const metadata = (await request.clone().json()) as Record<string, unknown>;
        return Response.json(
          {
            ...metadata,
            ...(options.returnedRedirect ? { redirect_uris: [options.returnedRedirect] } : {}),
            client_id: 'dynamically-registered-client',
          },
          { status: 201 },
        );
      },
      { preconnect: fetch.preconnect },
    ),
  });
  return { register, requests };
}

test('Granola discovers its authorization server and registers a public OAuth client for the host callback', async () => {
  const f = fixture();
  expect(await f.register(input)).toEqual({ clientId: 'dynamically-registered-client' });
  expect(await f.requests.at(-1)!.json()).toEqual({
    client_name: 'Context Use',
    redirect_uris: [input.redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: input.scopes.join(' '),
  });
});

test('Granola rejects discovery that would send registration to a different origin', async () => {
  const f = fixture({ registrationEndpoint: 'https://unexpected.example/register' });
  await expect(f.register(input)).rejects.toThrow('Unexpected Granola OAuth endpoint');
  expect(f.requests.every((request) => request.method === 'GET')).toBe(true);
});

test('Granola rejects a client that was not registered for this host callback', async () => {
  const f = fixture({ returnedRedirect: 'https://unexpected.example/callback' });
  await expect(f.register(input)).rejects.toThrow('incompatible OAuth client');
});
