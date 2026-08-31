export const DEFAULT_BACKEND_PORT = 3000;
export const DEFAULT_FRONTEND_PORT = 5173;
export const DEFAULT_DATA_FOLDER = './data';

export const BACKEND_ENVIRONMENT = {
  port: 'PORT',
  baseUrl: 'BASE_URL',
  dataFolder: 'DATA_FOLDER',
  authSecret: 'BETTER_AUTH_SECRET',
  nibrunHostname: 'NIBRUN_HOSTNAME',
} as const;

export type BackendEnvironmentVariable =
  (typeof BACKEND_ENVIRONMENT)[keyof typeof BACKEND_ENVIRONMENT];

export const LOCAL_PUBLIC_ORIGIN = `http://localhost:${DEFAULT_FRONTEND_PORT}`;
