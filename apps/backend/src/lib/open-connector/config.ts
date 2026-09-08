import { Buffer } from 'node:buffer';
import { isIP } from 'node:net';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import type { OpenConnectorReceiverSecretSource } from '#lib/open-connector/receiver-secret.ts';
import { loadOpenConnectorReceiverSecret } from '#lib/open-connector/receiver-secret.ts';

export const OPEN_CONNECTOR_RECORDS_PATH = '/api/integrations/open-connector/records';
export const OPEN_CONNECTOR_RECEIVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const OPEN_CONNECTOR_MAX_BEARER_TOKEN_BYTES = 8_192;
const IPV4_FAMILY = 4;
const IPV6_FAMILY = 6;
const FIRST_VISIBLE_ASCII_CODE_UNIT = 0x21;
const LAST_VISIBLE_ASCII_CODE_UNIT = 0x7e;

export const OPEN_CONNECTOR_ENVIRONMENT = {
  baseUrl: 'OPEN_CONNECTOR_BASE_URL',
  adminToken: 'OPEN_CONNECTOR_ADMIN_TOKEN',
  receiverId: 'OPEN_CONNECTOR_RECEIVER_ID',
  callbackUrl: 'OPEN_CONNECTOR_CALLBACK_URL',
  receiverToken: 'OPEN_CONNECTOR_RECEIVER_TOKEN',
  ownerId: 'OPEN_CONNECTOR_OWNER_ID',
} as const;

type Environment = Readonly<Record<string, string | undefined>>;

export type OpenConnectorReceiverRuntimeConfig = {
  /** The local trust-boundary namespace. It deliberately matches the stable receiver ID. */
  integrationId: string;
  receiverId: string;
  ownerId: string;
  bearerToken: string;
  bearerTokenSource: OpenConnectorReceiverSecretSource;
};

export type OpenConnectorSetupConfig = OpenConnectorReceiverRuntimeConfig & {
  baseUrl: URL;
  adminToken: string;
  callbackUrl: URL;
};

type LoadConfigInput = {
  dataFolder: string;
  environment: Environment;
};

function configuredValue({
  environment,
  name,
}: {
  environment: Environment;
  name: string;
}): string | undefined {
  const value = environment[name];
  return value && value.length > 0 ? value : undefined;
}

function requiredValue({ environment, name }: { environment: Environment; name: string }): string {
  const value = configuredValue({ environment, name });
  if (!value) {
    throw new Error(`${name} is required for open-connector setup.`);
  }
  return value;
}

function identifier({ value, name }: { value: string; name: string }): string {
  if (value !== value.trim()) {
    throw new Error(`${name} must not have leading or trailing whitespace.`);
  }
  if (!OPEN_CONNECTOR_RECEIVER_ID_PATTERN.test(value)) {
    throw new Error(
      `${name} must match ${OPEN_CONNECTOR_RECEIVER_ID_PATTERN.source} and be at most 128 characters.`,
    );
  }
  return value;
}

function ownerId(value: string): string {
  if (value !== OWNER_USER_ID) {
    throw new Error(
      `${OPEN_CONNECTOR_ENVIRONMENT.ownerId} must be ${OWNER_USER_ID}, the claimed Context Use owner.`,
    );
  }
  return value;
}

function bearerToken({ value, name }: { value: string; name: string }): string {
  if (
    value.length === 0 ||
    !isVisibleAscii(value) ||
    Buffer.byteLength(value, 'utf8') > OPEN_CONNECTOR_MAX_BEARER_TOKEN_BYTES
  ) {
    throw new Error(
      `${name} must be a visible ASCII Bearer token no larger than ${OPEN_CONNECTOR_MAX_BEARER_TOKEN_BYTES} bytes.`,
    );
  }
  return value;
}

function isVisibleAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < FIRST_VISIBLE_ASCII_CODE_UNIT || codeUnit > LAST_VISIBLE_ASCII_CODE_UNIT) {
      return false;
    }
  }
  return true;
}

function parseUrl({ value, name }: { value: string; name: string }): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
}

function baseUrl(value: string): URL {
  const url = parseUrl({ value, name: OPEN_CONNECTOR_ENVIRONMENT.baseUrl });
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${OPEN_CONNECTOR_ENVIRONMENT.baseUrl} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(
      `${OPEN_CONNECTOR_ENVIRONMENT.baseUrl} must be an origin without credentials, a path, query, or fragment.`,
    );
  }
  return url;
}

function unbracketedHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function isPrivateIpv4(hostname: string): boolean {
  return (
    hostname.startsWith('0.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('127.') ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('192.168.') ||
    /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./u.test(hostname)
  );
}

function isClearlyPrivateHostname(hostname: string): boolean {
  const normalized = unbracketedHostname(hostname).toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true;
  }
  const family = isIP(normalized);
  if (family === IPV4_FAMILY) {
    return isPrivateIpv4(normalized);
  }
  if (family === IPV6_FAMILY) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    );
  }
  return false;
}

function callbackUrl(value: string): URL {
  const url = parseUrl({ value, name: OPEN_CONNECTOR_ENVIRONMENT.callbackUrl });
  if (url.protocol !== 'https:') {
    throw new Error(`${OPEN_CONNECTOR_ENVIRONMENT.callbackUrl} must use public HTTPS.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      `${OPEN_CONNECTOR_ENVIRONMENT.callbackUrl} must not contain credentials, a query, or a fragment.`,
    );
  }
  if (url.pathname !== OPEN_CONNECTOR_RECORDS_PATH) {
    throw new Error(
      `${OPEN_CONNECTOR_ENVIRONMENT.callbackUrl} must end at ${OPEN_CONNECTOR_RECORDS_PATH}.`,
    );
  }
  if (isClearlyPrivateHostname(url.hostname)) {
    throw new Error(
      `${OPEN_CONNECTOR_ENVIRONMENT.callbackUrl} must use a public hostname; use an HTTPS tunnel for local development.`,
    );
  }
  return url;
}

function receiverValues(environment: Environment): {
  receiverId: string | undefined;
  ownerId: string | undefined;
  environmentSecret: string | undefined;
  anyConfigured: boolean;
} {
  const receiverId = configuredValue({
    environment,
    name: OPEN_CONNECTOR_ENVIRONMENT.receiverId,
  });
  const configuredOwnerId = configuredValue({
    environment,
    name: OPEN_CONNECTOR_ENVIRONMENT.ownerId,
  });
  const environmentSecret = configuredValue({
    environment,
    name: OPEN_CONNECTOR_ENVIRONMENT.receiverToken,
  });
  return {
    receiverId,
    ownerId: configuredOwnerId,
    environmentSecret,
    anyConfigured: Boolean(receiverId || configuredOwnerId || environmentSecret),
  };
}

async function loadRequiredReceiverConfig({
  dataFolder,
  environment,
}: LoadConfigInput): Promise<OpenConnectorReceiverRuntimeConfig> {
  const values = receiverValues(environment);
  if (!values.receiverId) {
    throw new Error(
      `${OPEN_CONNECTOR_ENVIRONMENT.receiverId} is required to enable the open-connector receiver.`,
    );
  }
  if (!values.ownerId) {
    throw new Error(
      `${OPEN_CONNECTOR_ENVIRONMENT.ownerId} is required to map open-connector records to a trusted owner.`,
    );
  }
  const validatedReceiverId = identifier({
    value: values.receiverId,
    name: OPEN_CONNECTOR_ENVIRONMENT.receiverId,
  });
  const validatedOwnerId = ownerId(values.ownerId);
  const secret = await loadOpenConnectorReceiverSecret({
    dataFolder,
    environmentSecret: values.environmentSecret,
  });
  return {
    integrationId: validatedReceiverId,
    receiverId: validatedReceiverId,
    ownerId: validatedOwnerId,
    bearerToken: bearerToken({
      value: secret.value,
      name: 'The open-connector receiver token',
    }),
    bearerTokenSource: secret.source,
  };
}

/** Returns undefined only when none of the receiver-specific settings are present. */
export async function loadOpenConnectorReceiverRuntimeConfig({
  dataFolder,
  environment = process.env,
}: Partial<LoadConfigInput> & Pick<LoadConfigInput, 'dataFolder'>): Promise<
  OpenConnectorReceiverRuntimeConfig | undefined
> {
  if (!receiverValues(environment).anyConfigured) {
    return undefined;
  }
  return await loadRequiredReceiverConfig({ dataFolder, environment });
}

export async function loadOpenConnectorSetupConfig({
  dataFolder,
  environment = process.env,
}: Partial<LoadConfigInput> &
  Pick<LoadConfigInput, 'dataFolder'>): Promise<OpenConnectorSetupConfig> {
  const configuredBaseUrl = baseUrl(
    requiredValue({ environment, name: OPEN_CONNECTOR_ENVIRONMENT.baseUrl }),
  );
  const configuredCallbackUrl = callbackUrl(
    requiredValue({ environment, name: OPEN_CONNECTOR_ENVIRONMENT.callbackUrl }),
  );
  const adminToken = bearerToken({
    value: requiredValue({ environment, name: OPEN_CONNECTOR_ENVIRONMENT.adminToken }),
    name: OPEN_CONNECTOR_ENVIRONMENT.adminToken,
  });
  const receiver = await loadRequiredReceiverConfig({ dataFolder, environment });
  if (adminToken === receiver.bearerToken) {
    throw new Error('Open-connector admin and receiver Bearer tokens must be distinct.');
  }
  return {
    ...receiver,
    baseUrl: configuredBaseUrl,
    adminToken,
    callbackUrl: configuredCallbackUrl,
  };
}
