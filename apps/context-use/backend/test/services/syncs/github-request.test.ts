import { expect, test } from 'bun:test';
import type { ProviderResponse, SyncContext } from '@context-use/open-sync/definition';
import { postGithubGraphql } from '#backend/services/syncs/providers/github/request.ts';
import { page } from './github-fixture.ts';

const privateValue = 'private-token-cursor-and-pr-content';
const body = { query: privateValue, variables: { after: privateValue } };

function requestContext(post: SyncContext['provider']['post']) {
  const logs: Parameters<SyncContext['log']>[0][] = [];
  const abort = new AbortController();
  const context: SyncContext = {
    config: {},
    checkpoint: null,
    sourceId: 'source',
    signal: abort.signal,
    provider: {
      post,
      get: () => Promise.reject(new Error('Unexpected GET')),
      action: () => Promise.reject(new Error('Unexpected action')),
    },
    log: (event) => logs.push(event),
  };
  return { context, logs, abort };
}

test('request diagnostics correlate timing and safe response headers without logging payloads', async () => {
  const response = {
    status: 200,
    headers: {
      'X-GitHub-Request-Id': 'ABCD:1234:5678',
      'X-RateLimit-Remaining': '4999',
      'X-RateLimit-Reset': '1789736400',
      'set-cookie': privateValue,
      authorization: privateValue,
    },
    body: { ...page(), privateValue },
  };
  const { context, logs } = requestContext(({ body: received }) => {
    expect(received).toBe(body);
    return Promise.resolve(response);
  });
  expect(await postGithubGraphql({ context, body })).toBe(response);
  expect(logs).toHaveLength(2);
  const requestId = logs[0]!.fields!.requestId!;
  expect(requestId).toEqual(expect.any(String));
  expect(logs[1]).toEqual({
    message: 'github_request_finished',
    fields: {
      requestId,
      provider: 'github',
      method: 'POST',
      path: '/graphql',
      durationMs: expect.any(Number),
      status: 200,
      githubRequestId: 'ABCD:1234:5678',
      'x-ratelimit-remaining': 4999,
      'x-ratelimit-reset': 1789736400,
      outcome: 'success',
    },
  });
  expect(Number(logs[1]?.fields?.durationMs)).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(logs)).not.toContain(privateValue);
  expect(JSON.stringify(logs)).not.toContain('Improve local records');
});

const failureCases: { status: number; body: ProviderResponse['body']; outcome: string }[] = [
  { status: 401, body: { message: privateValue }, outcome: 'http_error' },
  { status: 429, body: privateValue, outcome: 'http_error' },
  { status: 200, body: privateValue, outcome: 'invalid_response' },
  {
    status: 200,
    body: {
      errors: [
        {
          message: privateValue,
          path: [privateValue],
          extensions: { code: 'undefinedField', typeName: 'Actor', fieldName: 'id', privateValue },
        },
      ],
    },
    outcome: 'graphql_error',
  },
];

test.each(failureCases)(
  'request failures remain visible at HTTP $status ($outcome)',
  async (input) => {
    const response: ProviderResponse = {
      status: input.status,
      body: input.body,
      headers: { 'retry-after': '60', 'x-github-request-id': `\u001b[31m${privateValue}` },
    };
    const { context, logs } = requestContext(() => Promise.resolve(response));
    expect(await postGithubGraphql({ context, body })).toBe(response);
    expect(logs[1]?.fields).toMatchObject({
      status: input.status,
      outcome: input.outcome,
      'retry-after': 60,
    });
    if (input.outcome === 'graphql_error') {
      expect(logs[1]?.fields?.errors).toEqual([
        { code: 'undefinedField', typeName: 'Actor', fieldName: 'id' },
      ]);
    }
    expect(JSON.stringify(logs)).not.toContain(privateValue);
  },
);

test.each([{ cancel: false }, { cancel: true }])(
  'transport failures preserve errors without exposing their messages (aborted: $cancel)',
  async ({ cancel }) => {
    const failure = new Error(privateValue);
    const { context, logs, abort } = requestContext(() => {
      if (cancel) {
        abort.abort();
      }
      return Promise.reject(failure);
    });
    await expect(postGithubGraphql({ context, body })).rejects.toBe(failure);
    expect(logs[1]?.fields?.outcome).toBe(cancel ? 'cancelled' : 'transport_error');
    expect(logs[1]?.fields?.requestId).toBe(logs[0]?.fields?.requestId);
    expect(JSON.stringify(logs)).not.toContain(privateValue);
  },
);
