import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/client';
import { AUTHORIZATION_SCOPE, AUTHORIZATION_TIMEOUT_MS, CALLBACK_URL } from './contract';
import { ConnectionError } from './error';
import type { ConnectionState } from './state';
import { writeState } from './state';

const STATE_BYTES = 32;

export function oauthProvider(input: {
  directory: string;
  state: ConnectionState;
  interactive: boolean;
}): OAuthClientProvider {
  const oauth = input.state.oauth;
  const persist = () => writeState(input);
  return {
    redirectUrl: CALLBACK_URL,
    clientMetadata: {
      client_name: 'OpenClaw — Context Use Memory',
      redirect_uris: [CALLBACK_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: AUTHORIZATION_SCOPE,
    },
    state: () => randomBytes(STATE_BYTES).toString('hex'),
    clientInformation: () => oauth.client,
    saveClientInformation: async (client) => {
      oauth.client = client;
      await persist();
    },
    tokens: () => oauth.tokens,
    saveTokens: async (tokens) => {
      oauth.tokens = tokens;
      await persist();
    },
    codeVerifier: () => {
      if (!oauth.verifier) {
        throw new ConnectionError('Authorization expired. Start connect again.');
      }
      return oauth.verifier;
    },
    saveCodeVerifier: async (verifier) => {
      if (!input.interactive) {
        throw new ConnectionError('Context Use needs authorization. Run connect again.');
      }
      oauth.verifier = verifier;
      await persist();
    },
    discoveryState: () => oauth.discovery,
    saveDiscoveryState: async (discovery) => {
      oauth.discovery = discovery;
      await persist();
    },
    redirectToAuthorization: async (url) => {
      if (!input.interactive) {
        throw new ConnectionError(
          'Context Use needs authorization. Run openclaw context-use connect <instance-url>.',
        );
      }
      const state = url.searchParams.get('state');
      if (!state) {
        throw new ConnectionError('Authorization did not include state.');
      }
      oauth.pending = { url: url.href, state, createdAt: Date.now() };
      await persist();
    },
    invalidateCredentials: async (scope) => {
      if (scope === 'all' || scope === 'client') {
        delete oauth.client;
      }
      if (scope === 'all' || scope === 'tokens') {
        delete oauth.tokens;
      }
      if (scope === 'all' || scope === 'verifier') {
        delete oauth.verifier;
        delete oauth.pending;
      }
      if (scope === 'all' || scope === 'discovery') {
        delete oauth.discovery;
      }
      await persist();
    },
  };
}

export function authorizationResponse(input: {
  redirectUrl: string;
  pending: ConnectionState['oauth']['pending'];
  now?: number;
}): { authorizationCode: string; iss?: string } {
  const pending = input.pending;
  if (!pending || (input.now ?? Date.now()) - pending.createdAt > AUTHORIZATION_TIMEOUT_MS) {
    throw new ConnectionError('No current authorization request. Start connect again.');
  }
  const callback = new URL(input.redirectUrl);
  const expected = new URL(CALLBACK_URL);
  if (
    callback.origin !== expected.origin ||
    callback.pathname !== expected.pathname ||
    callback.hash ||
    callback.username ||
    callback.password
  ) {
    throw new ConnectionError('The redirect URL does not match this connection.');
  }
  for (const key of ['code', 'state', 'iss', 'error']) {
    if (callback.searchParams.getAll(key).length > 1) {
      throw new ConnectionError('Duplicate authorization response parameter.');
    }
  }
  const state = Buffer.from(callback.searchParams.get('state') ?? '');
  const original = Buffer.from(pending.state);
  if (state.length !== original.length || !timingSafeEqual(state, original)) {
    throw new ConnectionError('The redirect belongs to a different authorization request.');
  }
  if (callback.searchParams.has('error')) {
    throw new ConnectionError('Authorization was declined. Start connect again when ready.');
  }
  const authorizationCode = callback.searchParams.get('code');
  if (!authorizationCode) {
    throw new ConnectionError('The redirect URL has no authorization code.');
  }
  return { authorizationCode, iss: callback.searchParams.get('iss') ?? undefined };
}
