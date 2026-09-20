// Adapted from Open Sync's GitHub example and massimoalbarello/open-connector.
import type { SyncContext } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { defineRecordSync } from '../../catalog.ts';
import { githubRecord } from './record.ts';
import { postGithubGraphql } from './request.ts';

const checkpointSchema = z.object({
  accountId: z.string().nullable(),
  cursor: z.string().nullable(),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  watermark: z.iso.datetime({ offset: true }).nullable(),
});
const initialCheckpoint = { accountId: null, cursor: null, startedAt: null, watermark: null };
const OVERLAP_MS = 300_000;
const PAGE_SIZE = 10;
const pullFields = `id number title body url state isDraft createdAt updatedAt
  repository { nameWithOwner } author { login ... on Node { id } }`;
const pageSchema = z.object({
  edges: z.array(z.object({ cursor: z.string().min(1), node: z.unknown() })).max(PAGE_SIZE),
  pageInfo: z.object({ hasNextPage: z.boolean() }),
});
const object = z.record(z.string(), z.unknown());
const errorsSchema = z.array(z.object({ type: z.string().optional() }));

async function request(context: SyncContext) {
  const checkpoint = checkpointSchema.parse(context.checkpoint);
  const order = checkpoint.watermark ? 'UPDATED_AT, direction: DESC' : 'CREATED_AT, direction: ASC';
  const response = await postGithubGraphql({
    context,
    body: {
      query: `query ContextUsePullRequests($after: String) { viewer { id pullRequests(first: ${PAGE_SIZE}, after: $after, orderBy: {field: ${order}}) { edges { cursor node { ${pullFields} } } pageInfo { hasNextPage } } } }`,
      variables: { after: checkpoint.cursor },
    },
  });
  const HTTP_OK = 200;
  if (response.status !== HTTP_OK) {
    throw new Error('GitHub request failed.');
  }
  const body = object.parse(response.body);
  if (body.errors !== undefined) {
    const errors = errorsSchema.parse(body.errors);
    if (
      errors.some(
        (error) => error.type === 'INVALID_CURSOR' || error.type === 'INVALID_CURSOR_ARGUMENTS',
      )
    ) {
      return null;
    }
    throw new Error('GitHub returned incomplete data.');
  }
  const viewer = object.parse(object.parse(body.data).viewer);
  const accountId = z.string().min(1).parse(viewer.id);
  if (checkpoint.accountId && checkpoint.accountId !== accountId) {
    throw new Error('The connected GitHub account changed.');
  }
  return { accountId, page: pageSchema.parse(viewer.pullRequests) };
}

function readEdges(input: {
  page: z.infer<typeof pageSchema>;
  checkpoint: z.infer<typeof checkpointSchema>;
  seen: Set<string>;
}) {
  const records = [];
  for (const edge of input.page.edges) {
    if (input.seen.has(edge.cursor)) {
      throw new Error('GitHub repeated a cursor.');
    }
    input.seen.add(edge.cursor);
    const record = githubRecord(edge.node);
    if (
      input.checkpoint.watermark &&
      Date.parse(record.sourceUpdatedAt) < Date.parse(input.checkpoint.watermark) - OVERLAP_MS
    ) {
      return { records, more: false };
    }
    records.push({ record, cursor: edge.cursor });
  }
  return { records, more: input.page.pageInfo.hasNextPage };
}

export async function* runGithubPullRequests(context: SyncContext) {
  let checkpoint = checkpointSchema.parse(context.checkpoint);
  checkpoint = { ...checkpoint, startedAt: checkpoint.startedAt ?? new Date().toISOString() };
  const seen = new Set(checkpoint.cursor ? [checkpoint.cursor] : []);
  while (true) {
    const response = await request({ ...context, checkpoint });
    if (!response) {
      if (!checkpoint.cursor) {
        throw new Error('GitHub rejected a fresh cursor.');
      }
      yield {
        deliverable: { records: [] },
        checkpoint: { ...checkpoint, cursor: null },
        complete: false,
      };
      return;
    }
    checkpoint = { ...checkpoint, accountId: response.accountId };
    const { page } = response;
    if (page.pageInfo.hasNextPage && !page.edges.length) {
      throw new Error('Incomplete GitHub pagination.');
    }
    const found = readEdges({ page, checkpoint, seen });
    for (const edge of found.records) {
      checkpoint = { ...checkpoint, cursor: edge.cursor };
      yield {
        deliverable: {
          records: [
            {
              operation: 'upsert' as const,
              kind: edge.record.source.kind,
              id: edge.record.source.id,
              data: edge.record,
            },
          ],
        },
        checkpoint,
        complete: false,
      };
    }
    if (!found.more) {
      yield {
        deliverable: { records: [] },
        checkpoint: {
          ...checkpoint,
          cursor: null,
          watermark: checkpoint.startedAt,
          startedAt: null,
        },
        complete: true,
      };
      return;
    }
  }
}

export const githubPullRequests = defineRecordSync({
  key: 'github-pull-requests',
  name: 'Pull requests',
  description: 'Pull requests you authored, saved as searchable records.',
  intervalMs: 900_000,
  kinds: ['pull-request'],
  definition: {
    id: 'github.pull-requests',
    version: '2',
    artifactId: 'context-use/github-pull-requests/2',
    name: 'GitHub pull requests',
    configSchema: { type: 'object', additionalProperties: false },
    checkpointSchema: JSON.parse(JSON.stringify(z.toJSONSchema(checkpointSchema))),
    initialCheckpoint,
    provider: { service: 'github', actions: [], proxyPostPaths: ['/graphql'] },
  },
  run: runGithubPullRequests,
});
