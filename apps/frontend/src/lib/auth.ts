import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient, type ReactAuthClient } from 'better-auth/react';

type PasskeyAuthClientOptions = {
  baseURL: string;
  plugins: [ReturnType<typeof passkeyClient>, ReturnType<typeof oauthProviderClient>];
};

const authClientOptions: PasskeyAuthClientOptions = {
  baseURL: window.location.origin,
  plugins: [passkeyClient(), oauthProviderClient()],
};

export const authClient: ReactAuthClient<PasskeyAuthClientOptions> =
  createAuthClient(authClientOptions);

export type Session = typeof authClient.$Infer.Session;
