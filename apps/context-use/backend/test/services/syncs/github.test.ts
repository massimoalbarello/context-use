import { expect, test } from 'bun:test';
import type { JsonObject } from '@context-use/open-sync/json';
import { validate } from '@octokit/graphql-schema';
import { stepGithubPullRequests } from '#backend/services/syncs/providers/github/pull-requests.ts';
import { githubContext, page, pull } from './github-fixture.ts';

function context(input: { response: JsonObject; checkpoint?: JsonObject }) {
  const requests: JsonObject[] = [];
  return {
    requests,
    value: githubContext({
      checkpoint: input.checkpoint,
      post: ({ body }) => {
        expect(validate(String(body.query))).toEqual([]);
        requests.push(body);
        return Promise.resolve({ status: 200, headers: {}, body: input.response });
      },
    }),
  };
}

test('a complete native page yields one atomic step with deterministic source content and timestamps', async () => {
  const first = context({
    response: page({ nodes: [pull(), pull({ id: 'PR_two' })], more: true }),
  });
  const step = await stepGithubPullRequests(first.value);
  expect(first.requests).toHaveLength(1);
  expect(first.requests[0]?.query).toContain('CREATED_AT, direction: ASC');
  expect(step.records.map((record) => record.id)).toEqual(['PR_one', 'PR_two']);
  expect(step.complete).toBe(false);
  expect(step.checkpoint).toEqual({ accountId: 'U_owner', cursor: 'cursor-1' });
  const replay = await stepGithubPullRequests(first.value);
  expect(replay).toEqual(step);
  const next = context({
    response: page({ cursor: 'next', nodes: [pull({ id: 'PR_three' })] }),
    checkpoint: step.checkpoint as JsonObject,
  });
  const done = await stepGithubPullRequests(next.value);
  expect(next.requests[0]?.variables).toEqual({ after: 'cursor-1' });
  expect(done.complete).toBe(true);
  expect(done.checkpoint).toEqual({ accountId: 'U_owner', cursor: null });
});

test('invalid records, partial pages, repeated cursors and changed accounts never yield partial output', async () => {
  for (const input of [
    { response: page({ nodes: [], more: true }) },
    { response: page({ nodes: [pull(), { id: 'invalid' }] }) },
    { response: page(), checkpoint: { accountId: 'U_owner', cursor: 'cursor-0' } },
    { response: page(), checkpoint: { accountId: 'other', cursor: null } },
    { response: { ...page(), errors: [{ type: 'UNKNOWN' }] } },
    { response: { ...page(), errors: null } },
    { response: { ...page(), errors: [{ type: 123 }] } },
  ]) {
    await expect(stepGithubPullRequests(context(input).value)).rejects.toThrow();
  }
});

test('expired cursors restart discovery while retaining account identity and never infer deletions', async () => {
  const value = context({
    response: { errors: [{ type: 'INVALID_CURSOR' }] },
    checkpoint: { accountId: 'U_owner', cursor: 'expired' },
  });
  expect(await stepGithubPullRequests(value.value)).toEqual({
    records: [],
    complete: false,
    checkpoint: { accountId: 'U_owner', cursor: null },
  });
  await expect(
    stepGithubPullRequests(context({ response: { errors: [{ type: 'INVALID_CURSOR' }] } }).value),
  ).rejects.toThrow('incomplete');
  expect(
    (await stepGithubPullRequests(context({ response: page({ nodes: [] }) }).value)).records,
  ).toEqual([]);
});
