import { resolve } from 'node:path';
import {
  BACKEND_ENVIRONMENT,
  type BackendEnvironmentVariable,
  DEFAULT_BACKEND_PORT,
  DEFAULT_DATA_FOLDER,
  LOCAL_PUBLIC_ORIGIN,
  missingRequiredEnvironmentVariableMessage,
} from '#lib/runtime-config.ts';

// nibrun injects `NIBRUN_HOSTNAME` as the bare `<slug>.nibrun.app` the app is served on, always
// over HTTPS, so a deployed binary knows its own public origin without anyone setting `BASE_URL`.
// An explicit `BASE_URL` still wins — it is what a custom domain is configured with.
function defaultBaseUrl(): string {
  const nibrunHostname = process.env[BACKEND_ENVIRONMENT.nibrunHostname];
  return nibrunHostname ? `https://${nibrunHostname}` : LOCAL_PUBLIC_ORIGIN;
}

function required(name: BackendEnvironmentVariable): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(missingRequiredEnvironmentVariableMessage(name));
  }
  return value;
}

function optional({
  name,
  defaultValue,
}: {
  name: BackendEnvironmentVariable;
  defaultValue: string;
}): string {
  return process.env[name] || defaultValue;
}

type Env = {
  PORT: number;
  BASE_URL: URL;
  DATA_FOLDER: string;
  BETTER_AUTH_SECRET: string;
};

export function loadEnv(): Env {
  return {
    PORT: Number(
      optional({ name: BACKEND_ENVIRONMENT.port, defaultValue: String(DEFAULT_BACKEND_PORT) }),
    ),
    BASE_URL: new URL(
      optional({ name: BACKEND_ENVIRONMENT.baseUrl, defaultValue: defaultBaseUrl() }),
    ),
    DATA_FOLDER: resolve(
      optional({ name: BACKEND_ENVIRONMENT.dataFolder, defaultValue: DEFAULT_DATA_FOLDER }),
    ),
    BETTER_AUTH_SECRET: required(BACKEND_ENVIRONMENT.authSecret),
  };
}
