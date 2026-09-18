import { expect, test } from 'bun:test';
import type { ProviderOperations, SyncContext, SyncPage } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { validate } from '@octokit/graphql-schema';
import {
  githubPullRequests,
  runGithubPullRequests,
} from '#backend/services/syncs/providers/github/pull-requests.ts';
import { now, page, pull } from './github-fixture.ts';

function context(input: {
  responses: JsonObject[];
  checkpoint?: SyncContext['checkpoint'];
  signal?: AbortSignal;
}) {
  const requests: JsonObject[] = [];
  const provider: ProviderOperations = {
    action: () => Promise.reject(new Error('Unexpected action')),
    get: () => Promise.reject(new Error('Unexpected GET')),
    post: ({ body }) => {
      // Validate the wire query against GitHub's schema before returning fixture data.
      const errors = validate(String(body.query));
      if (errors.length) {
        throw new Error(errors.map((error) => error.message).join('\n'));
      }
      requests.push(body);
      const response = input.responses.shift();
      if (!response) {
        throw new Error('Unexpected page');
      }
      return Promise.resolve({ status: 200, headers: {}, body: response });
    },
  };
  return {
    requests,
    value: {
      config: {},
      checkpoint: input.checkpoint ?? githubPullRequests.registration.definition.initialCheckpoint,
      sourceId: 'source',
      signal: input.signal ?? new AbortController().signal,
      provider,
      log: () => {},
    } satisfies SyncContext,
  };
}
async function collect(value: SyncContext) {
  const pages: SyncPage[] = [];
  for await (const result of runGithubPullRequests(value)) {
    pages.push(result);
  }
  return pages;
}

test('authored PR backfill resumes committed cursors and only completes after the final page', async () => {
  const first = context({
    responses: [page({ more: true }), { errors: [{ type: 'RATE_LIMITED' }] }],
  });
  const iterator = runGithubPullRequests(first.value);
  const committed = (await iterator.next()).value!;
  expect(committed.complete).toBe(false);
  await expect(iterator.next()).rejects.toThrow('incomplete');
  const resumed = context({
    checkpoint: committed.checkpoint,
    responses: [page({ cursor: 'next', nodes: [pull({ id: 'PR_two' })] })],
  });
  const results = await collect(resumed.value);
  expect(resumed.requests[0]?.variables).toEqual({ after: 'cursor-0' });
  expect(results[0]?.deliverable.records[0]?.id).toBe('PR_two');
  expect(results.at(-1)?.complete).toBe(true);
  const checkpoint = results.at(-1)?.checkpoint as JsonObject;
  expect(checkpoint.cursor).toBeNull();
  expect(checkpoint.accountId).toBe('U_owner');
  expect(typeof checkpoint.watermark).toBe('string');
});

test('incremental scan overlaps its watermark and stops at older records without inferring deletions', async () => {
  const value = context({
    checkpoint: { accountId: 'U_owner', cursor: null, startedAt: null, watermark: now },
    responses: [
      page({
        nodes: [pull(), pull({ id: 'PR_old', updatedAt: '2026-09-17T11:00:00.000Z' })],
        more: true,
      }),
    ],
  });
  const results = await collect(value.value);
  expect(
    results.flatMap((result) => result.deliverable.records).map((record) => record.id),
  ).toEqual(['PR_one']);
  expect(results.at(-1)?.complete).toBe(true);
  expect(value.requests[0]?.query).toContain('UPDATED_AT');
});

test('partial pages, repeated cursors, changed accounts, and expired cursors preserve safe checkpoints', async () => {
  await expect(
    collect(context({ responses: [page({ nodes: [], more: true })] }).value),
  ).rejects.toThrow('pagination');
  await expect(
    collect(context({ responses: [page({ more: true }), page()] }).value),
  ).rejects.toThrow('repeated');
  await expect(
    collect(
      context({
        checkpoint: { accountId: 'different', cursor: null, startedAt: null, watermark: now },
        responses: [page()],
      }).value,
    ),
  ).rejects.toThrow('account changed');
  const expired = await collect(
    context({
      checkpoint: { accountId: 'U_owner', cursor: 'expired', startedAt: now, watermark: now },
      responses: [{ errors: [{ type: 'INVALID_CURSOR' }] }],
    }).value,
  );
  expect(expired).toEqual([
    {
      deliverable: { records: [] },
      checkpoint: { accountId: 'U_owner', cursor: null, startedAt: now, watermark: now },
      complete: false,
    },
  ]);
});
