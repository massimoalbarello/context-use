import { expect, test } from 'bun:test';
import type { JsonObject } from '@context-use/open-sync/json';
import { validate } from '@octokit/graphql-schema';
import { stepGithubPullRequests } from '#backend/services/syncs/sources/github/pull-requests.ts';
import { githubContext, now, page, pull } from './github-fixture.ts';

const initialCheckpoint = { accountId: null, cursor: null, cycleStartedAt: null, watermark: null };
const updateCheckpoint = {
  accountId: 'U_owner',
  cursor: null,
  cycleStartedAt: '2026-09-17T12:15:00.000Z',
  watermark: now,
};
const cutoff = '2026-09-17T11:55:00.000Z';
const beforeCutoff = '2026-09-17T11:54:59.999Z';
function context(input: { response: JsonObject; checkpoint?: JsonObject }) {
  const requests: JsonObject[] = [];
  const requestedAt: number[] = [];
  return {
    requests,
    requestedAt,
    value: githubContext({
      checkpoint: input.checkpoint,
      post: ({ body }) => {
        expect(validate(String(body.query))).toEqual([]);
        requestedAt.push(Date.now());
        requests.push(body);
        return Promise.resolve({ status: 200, headers: {}, body: input.response });
      },
    }),
  };
}

test('backfill returns one complete native page and freezes its start before retrieval until the last page', async () => {
  const before = Date.now();
  const first = context({
    response: page({ nodes: [pull(), pull({ id: 'PR_two' })], more: true }),
  });
  const step = await stepGithubPullRequests(first.value);
  const checkpoint = step.checkpoint as JsonObject;
  const cycleStartedAt = String(checkpoint.cycleStartedAt);
  expect(Date.parse(cycleStartedAt)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(cycleStartedAt)).toBeLessThanOrEqual(first.requestedAt[0]!);
  expect(first.requests).toHaveLength(1);
  expect(first.requests[0]?.query).toContain('CREATED_AT, direction: ASC');
  expect(step.records.map((record) => record.id)).toEqual(['PR_one', 'PR_two']);
  expect(step.records[0]).toMatchObject({ createdAt: now, updatedAt: now });
  expect(step.complete).toBe(false);
  expect(checkpoint).toEqual({
    accountId: 'U_owner',
    cursor: 'cursor-1',
    cycleStartedAt,
    watermark: null,
  });
  const replay = context({
    response: page({ nodes: [pull(), pull({ id: 'PR_two' })], more: true }),
    checkpoint: { ...initialCheckpoint, cycleStartedAt },
  });
  expect(await stepGithubPullRequests(replay.value)).toEqual(step);
  const next = context({
    response: page({ cursor: 'next', nodes: [pull({ id: 'PR_three' })] }),
    checkpoint,
  });
  const done = await stepGithubPullRequests(next.value);
  expect(next.requests[0]?.variables).toEqual({ after: 'cursor-1' });
  expect(done.complete).toBe(true);
  expect(done.checkpoint).toEqual({
    accountId: 'U_owner',
    cursor: null,
    cycleStartedAt: null,
    watermark: cycleStartedAt,
  });
});

test('incremental polls include cutoff ties across native pages and stop before the historical tail', async () => {
  const first = context({
    checkpoint: updateCheckpoint,
    response: page({ nodes: [pull(), pull({ id: 'tie-one', updatedAt: cutoff })], more: true }),
  });
  const step = await stepGithubPullRequests(first.value);
  expect(first.requests[0]?.query).toContain('UPDATED_AT, direction: DESC');
  expect(step.complete).toBe(false);
  expect(step.checkpoint).toEqual({ ...updateCheckpoint, cursor: 'cursor-1' });
  const next = context({
    checkpoint: step.checkpoint as JsonObject,
    response: page({
      cursor: 'next',
      nodes: [
        pull({ id: 'tie-two', updatedAt: cutoff }),
        pull({ id: 'old', updatedAt: beforeCutoff }),
      ],
      more: true,
    }),
  });
  const done = await stepGithubPullRequests(next.value);
  expect(next.requests[0]?.variables).toEqual({ after: 'cursor-1' });
  expect(done.records.map((record) => record.id)).toEqual(['tie-two']);
  expect(done.complete).toBe(true);
  expect(done.checkpoint).toEqual({
    ...updateCheckpoint,
    cursor: null,
    cycleStartedAt: null,
    watermark: updateCheckpoint.cycleStartedAt,
  });
  const unchanged = context({
    checkpoint: updateCheckpoint,
    response: page({ nodes: [pull({ updatedAt: beforeCutoff })], more: true }),
  });
  expect(await stepGithubPullRequests(unchanged.value)).toMatchObject({
    complete: true,
    records: [],
  });
  expect(unchanged.requests).toHaveLength(1);
});

test('invalid records, partial pages, update-order violations, repeated cursors and changed accounts never yield partial output', async () => {
  for (const input of [
    { response: page({ nodes: [], more: true }) },
    { response: page({ nodes: [pull(), { id: 'invalid' }] }) },
    {
      response: page(),
      checkpoint: { ...initialCheckpoint, accountId: 'U_owner', cursor: 'cursor-0' },
    },
    { response: page(), checkpoint: { ...initialCheckpoint, accountId: 'other' } },
    { response: { ...page(), errors: [{ type: 'UNKNOWN' }] } },
    { response: { ...page(), errors: null } },
    { response: { ...page(), errors: [{ type: 123 }] } },
    {
      response: page({ nodes: [pull({ updatedAt: beforeCutoff }), pull()] }),
      checkpoint: updateCheckpoint,
    },
  ]) {
    const source = context(input);
    const original = structuredClone(source.value.checkpoint);
    await expect(stepGithubPullRequests(source.value)).rejects.toThrow();
    expect(source.value.checkpoint).toEqual(original);
  }
});

test('expired cursors restart only the current cycle while retaining its account, start and watermark', async () => {
  for (const state of [{ ...initialCheckpoint, cycleStartedAt: now }, updateCheckpoint]) {
    const checkpoint = { ...state, accountId: 'U_owner', cursor: 'expired' };
    const value = context({ response: { errors: [{ type: 'INVALID_CURSOR' }] }, checkpoint });
    expect(await stepGithubPullRequests(value.value)).toEqual({
      records: [],
      complete: false,
      checkpoint: { ...checkpoint, cursor: null },
    });
  }
  await expect(
    stepGithubPullRequests(context({ response: { errors: [{ type: 'INVALID_CURSOR' }] } }).value),
  ).rejects.toThrow('incomplete');
  expect(
    (await stepGithubPullRequests(context({ response: page({ nodes: [] }) }).value)).records,
  ).toEqual([]);
});
