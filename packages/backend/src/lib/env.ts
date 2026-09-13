import { isAbsolute, relative, resolve } from 'node:path';
import {
  BACKEND_ENVIRONMENT,
  type BackendEnvironmentVariable,
  DEFAULT_BACKEND_PORT,
  DEFAULT_DATA_FOLDER,
  LOCAL_PUBLIC_ORIGIN,
  NIBRUN_DATA_FOLDER,
} from '#lib/runtime-config.ts';

// nibrun injects `NIBRUN_HOSTNAME` as the bare `<slug>.nibrun.app` the app is served on, always
// over HTTPS, so a deployed binary knows its own public origin without anyone setting `BASE_URL`.
// An explicit `BASE_URL` still wins — it is what a custom domain is configured with.
function defaultBaseUrl({ environment }: { environment: Environment }): string {
  const nibrunHostname = environment[BACKEND_ENVIRONMENT.nibrunHostname];
  return nibrunHostname ? `https://${nibrunHostname}` : LOCAL_PUBLIC_ORIGIN;
}

function optional({
  environment,
  name,
  defaultValue,
}: {
  environment: Environment;
  name: BackendEnvironmentVariable;
  defaultValue: string;
}): string {
  return environment[name] || defaultValue;
}

type Environment = Readonly<Record<string, string | undefined>>;

type Env = {
  PORT: number;
  BASE_URL: URL;
  DATA_FOLDER: string;
  BETTER_AUTH_SECRET: string | undefined;
};

function dataFolder({ environment, workingDirectory }: LoadEnvInput): string {
  const onNibrun = Boolean(environment[BACKEND_ENVIRONMENT.nibrunHostname]);
  const configured = optional({
    environment,
    name: BACKEND_ENVIRONMENT.dataFolder,
    defaultValue: onNibrun ? NIBRUN_DATA_FOLDER : DEFAULT_DATA_FOLDER,
  });
  const resolved = resolve(workingDirectory, configured);
  if (!onNibrun) {
    return resolved;
  }

  const relativePath = relative(NIBRUN_DATA_FOLDER, resolved);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(
      `${BACKEND_ENVIRONMENT.dataFolder} must be inside ${NIBRUN_DATA_FOLDER} on nibrun so application and authorization state survive deployments.`,
    );
  }
  return resolved;
}

type LoadEnvInput = {
  environment: Environment;
  workingDirectory: string;
};

export function loadEnv({
  environment = process.env,
  workingDirectory = process.cwd(),
}: Partial<LoadEnvInput> = {}): Env {
  return {
    PORT: Number(
      optional({
        environment,
        name: BACKEND_ENVIRONMENT.port,
        defaultValue: String(DEFAULT_BACKEND_PORT),
      }),
    ),
    BASE_URL: new URL(
      optional({
        environment,
        name: BACKEND_ENVIRONMENT.baseUrl,
        defaultValue: defaultBaseUrl({ environment }),
      }),
    ),
    DATA_FOLDER: dataFolder({ environment, workingDirectory }),
    BETTER_AUTH_SECRET: environment[BACKEND_ENVIRONMENT.authSecret] || undefined,
  };
}
