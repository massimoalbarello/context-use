import { expect, test } from 'bun:test';
import type { ProviderResponse } from '@context-use/open-sync/definition';
import { SourceHttpError } from '@context-use/open-sync/definition';
import { postGithubGraphql } from '#backend/services/syncs/providers/github/request.ts';
import { githubContext, page } from './github-fixture.ts';

const cases: { response: ProviderResponse; status: number }[] = [
  { response: { status: 401, headers: {}, body: 'private token' }, status: 401 },
  { response: { status: 503, headers: {}, body: 'unavailable' }, status: 503 },
  { response: { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: {} }, status: 429 },
  { response: { status: 403, headers: {}, body: {} }, status: 403 },
  {
    response: { status: 200, headers: {}, body: { errors: [{ type: 'RATE_LIMITED' }] } },
    status: 429,
  },
  {
    response: { status: 200, headers: {}, body: { errors: [{ type: 'FORBIDDEN' }] } },
    status: 403,
  },
];
test.each(cases)(
  'GitHub failures retain HTTP classification without provider payloads ($status)',
  async ({ response, status }) => {
    const context = githubContext({ post: async () => response });
    await expect(postGithubGraphql({ context, body: {} })).rejects.toMatchObject({
      code: `source_http_${status}`,
      status,
    });
  },
);

test('bound transport failures preserve classification, and cancellation prevents output', async () => {
  const failure = new SourceHttpError({ status: 429 });
  await expect(
    postGithubGraphql({
      context: githubContext({ post: () => Promise.reject(failure) }),
      body: {},
    }),
  ).rejects.toBe(failure);
  const abort = new AbortController();
  const context = githubContext({
    signal: abort.signal,
    post: () => {
      abort.abort();
      return Promise.resolve({ status: 200, headers: {}, body: page() });
    },
  });
  await expect(postGithubGraphql({ context, body: {} })).rejects.toThrow();
});
