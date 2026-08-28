import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient, type ReactAuthClient } from 'better-auth/react';

type PasskeyAuthClientOptions = {
  baseURL: string;
  plugins: [ReturnType<typeof passkeyClient>];
};

const authClientOptions: PasskeyAuthClientOptions = {
  baseURL: window.location.origin,
  plugins: [passkeyClient()],
};

export const authClient: ReactAuthClient<PasskeyAuthClientOptions> =
  createAuthClient(authClientOptions);

export type Session = typeof authClient.$Infer.Session;
