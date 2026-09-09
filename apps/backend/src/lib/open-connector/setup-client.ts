import type { OpenConnectorSetupConfig } from '#lib/open-connector/config.ts';

const GITHUB_PULL_REQUESTS_DEFINITION_ID = 'github.pull-requests';
const DEFAULT_CONNECTION_NAME = 'default';
const DEFAULT_MAX_PAGES = 100;
const REGISTRATION_TIMEOUT_MILLISECONDS = 30_000;
const ACQUISITION_TIMEOUT_MILLISECONDS = 660_000;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_UPSTREAM_ERROR_MESSAGE_CHARACTERS = 1_000;
const MAX_UPSTREAM_IDENTIFIER_CHARACTERS = 1_024;
const FIRST_PRINTABLE_CODE_POINT = 32;
const DELETE_CODE_POINT = 127;
const UPSTREAM_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const HTTP_STATUS = {
  ok: 200,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
} as const;

type Fetch = typeof globalThis.fetch;

export class OpenConnectorSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenConnectorSetupError';
  }
}

export type OpenConnectorRunResult =
  | {
      state: 'completed';
      complete: boolean;
      installationId: string;
      runId: string;
      pages: number;
      records: number;
    }
  | { state: 'run_busy' };

function endpoint({ baseUrl, path }: { baseUrl: URL; path: string }): URL {
  return new URL(path, baseUrl);
}

async function send({
  fetch: fetchImplementation,
  url,
  method,
  adminToken,
  body,
  operation,
  timeoutMilliseconds,
}: {
  fetch: Fetch;
  url: URL;
  method: 'POST' | 'PUT';
  adminToken: string;
  body: unknown;
  operation: string;
  timeoutMilliseconds: number;
}): Promise<Response> {
  try {
    return await fetchImplementation(url, {
      method,
      redirect: 'error',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
  } catch {
    throw new OpenConnectorSetupError(
      `Could not ${operation} at ${url.origin}. Check OPEN_CONNECTOR_BASE_URL and network access.`,
    );
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The actionable HTTP status remains more useful than a body-cancellation failure.
  }
}

async function readBoundedJson(response: Response): Promise<unknown | undefined> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await cancelResponseBody(response);
    return undefined;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(chunk.value);
    }
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

type UpstreamErrorDetails = {
  code?: string;
  message?: string;
};

function secretsByDescendingLength(secrets: string[]): string[] {
  const remaining = new Set(secrets.filter((secret) => secret.length > 0));
  const ordered: string[] = [];
  while (remaining.size > 0) {
    let longest: string | undefined;
    for (const candidate of remaining) {
      if (longest === undefined || candidate.length > longest.length) {
        longest = candidate;
      }
    }
    if (longest === undefined) {
      break;
    }
    ordered.push(longest);
    remaining.delete(longest);
  }
  return ordered;
}

function safeUpstreamText({ value, secrets }: { value: string; secrets: string[] }): string {
  let redacted = value;
  for (const secret of secretsByDescendingLength(secrets)) {
    redacted = redacted.replaceAll(secret, '[redacted]');
  }
  return [...redacted]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined &&
        (codePoint < FIRST_PRINTABLE_CODE_POINT || codePoint === DELETE_CODE_POINT)
        ? ' '
        : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

function responseErrorDetails({
  value,
  secrets,
}: {
  value: unknown;
  secrets: string[];
}): UpstreamErrorDetails {
  if (!value || typeof value !== 'object' || !('error' in value)) {
    return {};
  }
  const error = value.error;
  if (!error || typeof error !== 'object') {
    return {};
  }
  const candidateCode =
    'code' in error && typeof error.code === 'string'
      ? safeUpstreamText({ value: error.code, secrets })
      : undefined;
  const candidateMessage =
    'message' in error && typeof error.message === 'string'
      ? safeUpstreamText({ value: error.message, secrets }).slice(
          0,
          MAX_UPSTREAM_ERROR_MESSAGE_CHARACTERS,
        )
      : undefined;
  return {
    ...(candidateCode && UPSTREAM_ERROR_CODE_PATTERN.test(candidateCode)
      ? { code: candidateCode }
      : {}),
    ...(candidateMessage ? { message: candidateMessage } : {}),
  };
}

function upstreamDetailsSuffix(details: UpstreamErrorDetails): string {
  const parts = [
    ...(details.code ? [`code ${details.code}`] : []),
    ...(details.message ? [`message: ${details.message}`] : []),
  ];
  return parts.length > 0 ? ` Upstream error ${parts.join('; ')}.` : '';
}

function nonemptyIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_UPSTREAM_IDENTIFIER_CHARACTERS &&
    /\S/u.test(value)
  );
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function successfulRunResult(
  value: unknown,
): Exclude<OpenConnectorRunResult, { state: 'run_busy' }> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const result = value as Record<string, unknown>;
  const run = result.run;
  if (!run || typeof run !== 'object') {
    return null;
  }
  const runId = (run as Record<string, unknown>).id;
  if (
    typeof result.complete !== 'boolean' ||
    !nonemptyIdentifier(result.installationId) ||
    !nonemptyIdentifier(runId) ||
    !nonnegativeSafeInteger(result.pages) ||
    result.pages === 0 ||
    !nonnegativeSafeInteger(result.records)
  ) {
    return null;
  }
  return {
    state: 'completed',
    complete: result.complete,
    installationId: result.installationId,
    runId,
    pages: result.pages,
    records: result.records,
  };
}

function conflictError({
  operation,
  details,
}: {
  operation: string;
  details: UpstreamErrorDetails;
}) {
  const suffix = upstreamDetailsSuffix(details);
  if (details.code === 'credential_changed') {
    return new OpenConnectorSetupError(
      `Open-connector reports changed GitHub source credentials while trying to ${operation}. Restore or reverify the GitHub source connection, then retry without resetting its checkpoint.${suffix}`,
    );
  }
  if (details.code === 'binding_conflict') {
    return new OpenConnectorSetupError(
      `Open-connector reports a GitHub source binding conflict while trying to ${operation}. Restore or reverify the GitHub source connection binding, then retry without resetting its checkpoint.${suffix}`,
    );
  }
  return new OpenConnectorSetupError(
    `Open-connector reported a conflict while trying to ${operation} (HTTP 409). Check the delivery destination and credentials before retrying.${suffix}`,
  );
}

function setupApiError({
  status,
  operation,
  details,
}: {
  status: number;
  operation: string;
  details: UpstreamErrorDetails;
}): OpenConnectorSetupError {
  const suffix = upstreamDetailsSuffix(details);
  if (status === HTTP_STATUS.unauthorized || status === HTTP_STATUS.forbidden) {
    return new OpenConnectorSetupError(
      `Open-connector rejected OPEN_CONNECTOR_ADMIN_TOKEN while trying to ${operation}.${suffix}`,
    );
  }
  if (status === HTTP_STATUS.notFound) {
    return new OpenConnectorSetupError(
      `Open-connector's record-sync endpoint was not found while trying to ${operation}. Deploy a build containing the sync receiver, delivery, and scheduling endpoints.${suffix}`,
    );
  }
  if (status === HTTP_STATUS.conflict) {
    return conflictError({ operation, details });
  }
  return new OpenConnectorSetupError(
    `Open-connector could not ${operation} (HTTP ${status}).${suffix}`,
  );
}

async function readResponseError({
  response,
  config,
}: {
  response: Response;
  config: OpenConnectorSetupConfig;
}): Promise<UpstreamErrorDetails> {
  return responseErrorDetails({
    value: await readBoundedJson(response),
    secrets: [config.adminToken, config.deliveryApiKey],
  });
}

export async function configureOpenConnectorDestination({
  config,
  fetch = globalThis.fetch,
}: {
  config: OpenConnectorSetupConfig;
  fetch?: Fetch;
}): Promise<{ url: string; enabled: true }> {
  const operation = `configure the delivery destination for integration ${config.integrationId}`;
  const response = await send({
    fetch,
    url: endpoint({
      baseUrl: config.baseUrl,
      path: '/api/sync/destination',
    }),
    method: 'PUT',
    adminToken: config.adminToken,
    body: {
      url: config.callbackUrl.href,
      bearerToken: config.deliveryApiKey,
      enabled: true,
    },
    operation,
    timeoutMilliseconds: REGISTRATION_TIMEOUT_MILLISECONDS,
  });
  if (response.status !== HTTP_STATUS.ok) {
    throw setupApiError({
      status: response.status,
      operation,
      details: await readResponseError({ response, config }),
    });
  }

  const result = await readBoundedJson(response);
  if (
    !result ||
    typeof result !== 'object' ||
    !('destination' in result) ||
    !result.destination ||
    typeof result.destination !== 'object' ||
    !('url' in result.destination) ||
    result.destination.url !== config.callbackUrl.href ||
    !('enabled' in result.destination) ||
    result.destination.enabled !== true
  ) {
    throw new OpenConnectorSetupError(
      `Open-connector did not confirm the enabled delivery destination for integration ${config.integrationId}.`,
    );
  }
  return { url: config.callbackUrl.href, enabled: true };
}

async function runGithubPullRequestAcquisition({
  config,
  fetch,
  backfill,
}: {
  config: OpenConnectorSetupConfig;
  fetch: Fetch;
  backfill: boolean;
}): Promise<OpenConnectorRunResult> {
  const operation = backfill
    ? 'start the GitHub pull-request backfill'
    : 'continue the GitHub pull-request acquisition';
  const response = await send({
    fetch,
    url: endpoint({
      baseUrl: config.baseUrl,
      path: `/api/sync/definitions/${GITHUB_PULL_REQUESTS_DEFINITION_ID}/run`,
    }),
    method: 'POST',
    adminToken: config.adminToken,
    body: {
      connectionName: DEFAULT_CONNECTION_NAME,
      ...(backfill ? { backfill: true } : {}),
      maxPages: DEFAULT_MAX_PAGES,
    },
    operation,
    timeoutMilliseconds: ACQUISITION_TIMEOUT_MILLISECONDS,
  });
  if (!response.ok) {
    const details = await readResponseError({ response, config });
    if (response.status === HTTP_STATUS.conflict && details.code === 'run_busy') {
      return { state: 'run_busy' };
    }
    throw setupApiError({ status: response.status, operation, details });
  }
  const result = successfulRunResult(await readBoundedJson(response));
  if (!result) {
    throw new OpenConnectorSetupError(
      `Open-connector returned an invalid success response while trying to ${operation}. Deploy a compatible record-sync build and retry without resetting its checkpoint.`,
    );
  }
  return result;
}

export function startOpenConnectorBackfill({
  config,
  fetch = globalThis.fetch,
}: {
  config: OpenConnectorSetupConfig;
  fetch?: Fetch;
}): Promise<OpenConnectorRunResult> {
  return runGithubPullRequestAcquisition({ config, fetch, backfill: true });
}

export function continueOpenConnectorAcquisition({
  config,
  fetch = globalThis.fetch,
}: {
  config: OpenConnectorSetupConfig;
  fetch?: Fetch;
}): Promise<OpenConnectorRunResult> {
  return runGithubPullRequestAcquisition({ config, fetch, backfill: false });
}
