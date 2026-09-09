import { expect, test } from 'bun:test';
import type { OpenConnectorSetupConfig } from '#lib/open-connector/config.ts';
import {
  configureOpenConnectorDestination,
  continueOpenConnectorAcquisition,
  OpenConnectorSetupError,
  startOpenConnectorBackfill,
} from '#lib/open-connector/setup-client.ts';

const config: OpenConnectorSetupConfig = {
  integrationId: 'context-use',
  ownerId: 'context-use-owner',
  deliveryApiKey: 'integration-delivery-key',
  deliveryApiKeySource: { kind: 'environment' },
  adminToken: 'open-connector-admin-token',
  baseUrl: new URL('http://open-connector.internal:8787'),
  callbackUrl: new URL('https://context-use.example/api/integrations/open-connector/records'),
};
const OVERSIZED_RESPONSE_PADDING_BYTES = 70_000;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;

function acquisitionResponse({
  id,
  complete,
  pages,
  records,
}: {
  id: string;
  complete: boolean;
  pages: number;
  records: number;
}): Response {
  return Response.json({
    installationId: 'github-installation',
    run: {
      id,
      installationId: 'github-installation',
      state: 'succeeded',
    },
    complete,
    pages,
    records,
  });
}

function recordingFetch(responses: Response[]) {
  const requests: Request[] = [];
  const implementation = ((...arguments_: Parameters<typeof globalThis.fetch>) => {
    const [input, init] = arguments_;
    requests.push(
      input instanceof Request ? new Request(input, init) : new Request(String(input), init),
    );
    const response = responses.shift();
    if (!response) {
      throw new Error('Unexpected setup request');
    }
    return Promise.resolve(response);
  }) as typeof globalThis.fetch;
  return { fetch: implementation, requests };
}

test('destination setup uses admin authorization and sends the distinct delivery API key', async () => {
  const fixture = recordingFetch([
    Response.json(
      { destination: { url: config.callbackUrl.href, enabled: true } },
      { status: 200 },
    ),
  ]);

  expect(await configureOpenConnectorDestination({ config, fetch: fixture.fetch })).toEqual({
    url: config.callbackUrl.href,
    enabled: true,
  });
  expect(fixture.requests).toHaveLength(1);
  const [request] = fixture.requests;
  expect(request?.method).toBe('PUT');
  expect(request?.url).toBe('http://open-connector.internal:8787/api/sync/destination');
  expect(request?.redirect).toBe('error');
  expect(request?.headers.get('authorization')).toBe('Bearer open-connector-admin-token');
  const registrationBody = await request?.text();
  expect(JSON.parse(registrationBody ?? '')).toEqual({
    url: 'https://context-use.example/api/integrations/open-connector/records',
    bearerToken: 'integration-delivery-key',
    enabled: true,
  });
  expect(registrationBody).not.toContain(config.adminToken);
});

test('backfill is explicit and continuation omits the backfill reset flag', async () => {
  const fixture = recordingFetch([
    acquisitionResponse({ id: 'backfill-run', complete: false, pages: 100, records: 250 }),
    acquisitionResponse({ id: 'continuation-run', complete: true, pages: 4, records: 7 }),
  ]);

  expect(await startOpenConnectorBackfill({ config, fetch: fixture.fetch })).toEqual({
    state: 'completed',
    complete: false,
    installationId: 'github-installation',
    runId: 'backfill-run',
    pages: 100,
    records: 250,
  });
  expect(await continueOpenConnectorAcquisition({ config, fetch: fixture.fetch })).toEqual({
    state: 'completed',
    complete: true,
    installationId: 'github-installation',
    runId: 'continuation-run',
    pages: 4,
    records: 7,
  });

  const [backfill, continuation] = fixture.requests;
  expect(backfill?.url).toBe(
    'http://open-connector.internal:8787/api/sync/definitions/github.pull-requests/run',
  );
  expect(backfill?.headers.get('authorization')).toBe('Bearer open-connector-admin-token');
  expect(await backfill?.json()).toEqual({
    connectionName: 'default',
    backfill: true,
    maxPages: 100,
  });
  expect(await continuation?.json()).toEqual({
    connectionName: 'default',
    maxPages: 100,
  });
});

test('acquisition rejects missing, malformed, and oversized success responses', async () => {
  for (const response of [
    new Response(null, { status: 200 }),
    Response.json({ complete: true, pages: 1, records: 0 }, { status: 200 }),
    Response.json(
      {
        installationId: 'github-installation',
        run: { id: 'run-id' },
        complete: 'yes',
        pages: 1,
        records: 0,
      },
      { status: 200 },
    ),
    Response.json(
      {
        installationId: 'github-installation',
        run: { id: 'run-id' },
        complete: true,
        pages: 1,
        records: 0,
        padding: 'x'.repeat(OVERSIZED_RESPONSE_PADDING_BYTES),
      },
      { status: 200 },
    ),
  ]) {
    const fixture = recordingFetch([response]);
    await expect(
      continueOpenConnectorAcquisition({ config, fetch: fixture.fetch }),
    ).rejects.toThrow('invalid success response');
  }
});

test('only an explicit run_busy conflict is treated as an acquisition already in progress', async () => {
  const busy = recordingFetch([Response.json({ error: { code: 'run_busy' } }, { status: 409 })]);
  expect(await startOpenConnectorBackfill({ config, fetch: busy.fetch })).toEqual({
    state: 'run_busy',
  });

  for (const [code, expected] of [
    ['credential_changed', 'changed GitHub source credentials'],
    ['binding_conflict', 'GitHub source binding conflict'],
    ['another_conflict', 'HTTP 409'],
  ] as const) {
    const fixture = recordingFetch([Response.json({ error: { code } }, { status: 409 })]);
    await expect(
      continueOpenConnectorAcquisition({ config, fetch: fixture.fetch }),
    ).rejects.toThrow(expected);
  }

  const oversized = recordingFetch([
    Response.json(
      { error: { code: 'run_busy' }, padding: 'x'.repeat(OVERSIZED_RESPONSE_PADDING_BYTES) },
      { status: 409 },
    ),
  ]);
  await expect(
    continueOpenConnectorAcquisition({ config, fetch: oversized.fetch }),
  ).rejects.toThrow('HTTP 409');
});

test('common setup API configuration failures are actionable without exposing secrets', async () => {
  for (const [status, expected] of [
    [HTTP_UNAUTHORIZED, 'OPEN_CONNECTOR_ADMIN_TOKEN'],
    [HTTP_NOT_FOUND, 'record-sync endpoint was not found'],
  ] as const) {
    const fixture = recordingFetch([new Response(null, { status })]);
    const error = await configureOpenConnectorDestination({ config, fetch: fixture.fetch }).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(OpenConnectorSetupError);
    expect((error as Error).message).toContain(expected);
    expect((error as Error).message).not.toContain(config.adminToken);
    expect((error as Error).message).not.toContain(config.deliveryApiKey);
  }
});

test('registration surfaces bounded public-URL validation details without exposing credentials', async () => {
  const fixture = recordingFetch([
    Response.json(
      {
        error: {
          code: 'invalid_receiver_url',
          message: `Destination URL must resolve to a public address. ${config.adminToken}\n${config.deliveryApiKey}`,
        },
      },
      { status: HTTP_BAD_REQUEST },
    ),
  ]);

  const error = await configureOpenConnectorDestination({ config, fetch: fixture.fetch }).catch(
    (caught) => caught,
  );
  expect(error).toBeInstanceOf(OpenConnectorSetupError);
  expect((error as Error).message).toContain('invalid_receiver_url');
  expect((error as Error).message).toContain('must resolve to a public address');
  expect((error as Error).message).not.toContain('\n');
  expect((error as Error).message).not.toContain(config.adminToken);
  expect((error as Error).message).not.toContain(config.deliveryApiKey);
});

test('error redaction removes overlapping credentials longest-first', async () => {
  const overlappingConfig = {
    ...config,
    adminToken: 'shared-token',
    deliveryApiKey: 'shared-token-private-suffix',
  };
  const fixture = recordingFetch([
    Response.json(
      {
        error: {
          code: 'invalid_receiver_url',
          message: `Rejected credential ${overlappingConfig.deliveryApiKey}`,
        },
      },
      { status: HTTP_BAD_REQUEST },
    ),
  ]);

  const error = await configureOpenConnectorDestination({
    config: overlappingConfig,
    fetch: fixture.fetch,
  }).catch((caught) => caught);
  expect(error).toBeInstanceOf(OpenConnectorSetupError);
  expect((error as Error).message).not.toContain(overlappingConfig.adminToken);
  expect((error as Error).message).not.toContain('private-suffix');
});

test('backfill surfaces missing-connection and invalid-input diagnostics', async () => {
  for (const [code, message] of [
    ['connection_not_found', 'The default connection does not exist'],
    ['invalid_input', 'The receiver target is invalid'],
  ] as const) {
    const fixture = recordingFetch([
      Response.json({ error: { code, message } }, { status: HTTP_BAD_REQUEST }),
    ]);
    const error = await startOpenConnectorBackfill({ config, fetch: fixture.fetch }).catch(
      (caught) => caught,
    );

    expect(error).toBeInstanceOf(OpenConnectorSetupError);
    expect((error as Error).message).toContain(code);
    expect((error as Error).message).toContain(message);
    expect((error as Error).message).not.toContain(config.adminToken);
    expect((error as Error).message).not.toContain(config.deliveryApiKey);
  }
});

test('destination setup requires the exact enabled callback status', async () => {
  for (const response of [
    Response.json(
      { destination: { url: 'https://other.example/records', enabled: true } },
      { status: 200 },
    ),
    Response.json(
      { destination: { url: config.callbackUrl.href, enabled: false } },
      { status: 200 },
    ),
    new Response('not-json', { status: 200 }),
    new Response(null, { status: 500 }),
  ]) {
    const fixture = recordingFetch([response]);
    await expect(
      configureOpenConnectorDestination({ config, fetch: fixture.fetch }),
    ).rejects.toThrow();
  }
});
