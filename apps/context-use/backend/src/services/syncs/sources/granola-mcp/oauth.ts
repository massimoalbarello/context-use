import type { OAuthClientRegistration } from '@context-use/open-sync';
// biome-ignore lint/suspicious/noDeprecatedImports: Granola supports RFC 7591 and automatic setup requires DCR.
import { discoverOAuthServerInfo, registerClient } from '@modelcontextprotocol/client';

const resource = 'https://mcp.granola.ai/mcp';
const issuer = 'https://mcp-auth.granola.ai';

export function granolaClientRegistration(dependencies: {
  fetch: typeof fetch;
}): OAuthClientRegistration {
  return async (input) => {
    // The SDK owns discovery and RFC 7591 validation; constrain egress to this provider.
    const fetchFn: typeof globalThis.fetch = Object.assign(
      (...args: Parameters<typeof fetch>) => {
        const request =
          args[0] instanceof Request
            ? new Request(args[0], args[1])
            : new Request(String(args[0]), args[1]);
        const url = new URL(request.url);
        if (
          ![new URL(resource).origin, issuer].includes(url.origin) ||
          url.username ||
          url.password
        ) {
          throw new Error('Unexpected Granola OAuth endpoint.');
        }
        return dependencies.fetch(request, {
          redirect: 'error',
          signal: AbortSignal.any([input.signal, request.signal]),
        });
      },
      { preconnect: dependencies.fetch.preconnect },
    );
    const discovered = await discoverOAuthServerInfo(resource, { fetchFn });
    const metadata = discovered.authorizationServerMetadata;
    if (
      discovered.authorizationServerUrl !== issuer ||
      discovered.resourceMetadata?.resource !== resource ||
      !metadata?.registration_endpoint ||
      !metadata.code_challenge_methods_supported?.includes('S256') ||
      !metadata.token_endpoint_auth_methods_supported?.includes('none')
    ) {
      throw new Error('Granola OAuth discovery is incomplete.');
    }
    const client = await registerClient(issuer, {
      metadata,
      fetchFn,
      clientMetadata: {
        client_name: 'Context Use',
        redirect_uris: [input.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: input.scopes.join(' '),
      },
    });
    if (
      !client.client_id ||
      !client.redirect_uris.includes(input.redirectUri) ||
      client.token_endpoint_auth_method !== 'none'
    ) {
      throw new Error('Granola returned an incompatible OAuth client.');
    }
    return { clientId: client.client_id };
  };
}
