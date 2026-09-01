import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient, type ReactAuthClient } from 'better-auth/react';
import { applicationOrigin } from './application-origin';

type PasskeyAuthClientOptions = {
  baseURL: string;
  plugins: [ReturnType<typeof passkeyClient>, ReturnType<typeof oauthProviderClient>];
};

const authClientOptions: PasskeyAuthClientOptions = {
  baseURL: applicationOrigin(),
  plugins: [passkeyClient(), oauthProviderClient()],
};

export const authClient: ReactAuthClient<PasskeyAuthClientOptions> =
  createAuthClient(authClientOptions);

export type Session = typeof authClient.$Infer.Session;
