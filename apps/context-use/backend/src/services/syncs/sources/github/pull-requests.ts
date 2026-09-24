import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import { z } from 'zod';
import type { ContextSync } from '../../catalog.ts';
import { githubRecord, pullSchema } from './record.ts';
import { postGithubGraphql } from './request.ts';

const checkpointSchema = z.strictObject({
  accountId: z.string().nullable(),
  cursor: z.string().nullable(),
  cycleStartedAt: z.iso.datetime({ offset: true }).nullable(),
  watermark: z.iso.datetime({ offset: true }).nullable(),
});
const initialCheckpoint = { accountId: null, cursor: null, cycleStartedAt: null, watermark: null };
const UPDATE_OVERLAP_MS = 300_000;
const PAGE_SIZE = 10;
const pullFields = `id number title body url state isDraft createdAt updatedAt
  repository { nameWithOwner } author { login ... on Node { id } }`;
const pageSchema = z.object({
  edges: z.array(z.object({ cursor: z.string().min(1), node: pullSchema })).max(PAGE_SIZE),
  pageInfo: z.object({ hasNextPage: z.boolean() }),
});
const responseSchema = z.object({
  errors: z.never().optional(),
  data: z.object({ viewer: z.object({ id: z.string().min(1), pullRequests: pageSchema }) }),
});
const errorsSchema = z.object({ errors: z.array(z.object({ type: z.string().optional() })) });

// Backfill once in stable creation order; subsequent polls stop below the saved update window.
// Freeze the cycle start before retrieval so edits that move ahead of a cursor remain eligible next poll.
export async function stepGithubPullRequests(context: SyncContext): Promise<SyncStep> {
  context.signal.throwIfAborted();
  const checkpoint = checkpointSchema.parse(context.checkpoint);
  const cycleStartedAt = checkpoint.cycleStartedAt ?? new Date().toISOString();
  const updates = checkpoint.watermark !== null;
  const order = updates ? 'UPDATED_AT, direction: DESC' : 'CREATED_AT, direction: ASC';
  const response = await postGithubGraphql({
    context,
    body: {
      query: `query ContextUsePullRequests($after: String) { viewer { id pullRequests(first: ${PAGE_SIZE}, after: $after, orderBy: {field: ${order}}) { edges { cursor node { ${pullFields} } } pageInfo { hasNextPage } } } }`,
      variables: { after: checkpoint.cursor },
    },
  });
  const errors = errorsSchema.safeParse(response.body);
  if (errors.success) {
    if (
      checkpoint.cursor &&
      errors.data.errors.some(
        (error) => error.type === 'INVALID_CURSOR' || error.type === 'INVALID_CURSOR_ARGUMENTS',
      )
    ) {
      return {
        records: [],
        checkpoint: { ...checkpoint, cursor: null, cycleStartedAt },
        complete: false,
      };
    }
    throw new Error('GitHub returned incomplete data.');
  }
  const { viewer } = responseSchema.parse(response.body).data;
  if (checkpoint.accountId && checkpoint.accountId !== viewer.id) {
    throw new Error('The connected GitHub account changed. Create a new sync.');
  }
  const page = viewer.pullRequests;
  validatePage({ page, cursor: checkpoint.cursor, updates });
  const cutoff = checkpoint.watermark ? Date.parse(checkpoint.watermark) - UPDATE_OVERLAP_MS : null;
  const edges =
    cutoff === null
      ? page.edges
      : page.edges.filter(({ node }) => Date.parse(node.updatedAt) >= cutoff);
  const complete = !page.pageInfo.hasNextPage || edges.length < page.edges.length;
  const records = edges.map(({ node }) => githubRecord(node));
  context.signal.throwIfAborted();
  return {
    records,
    checkpoint: {
      accountId: viewer.id,
      cursor: complete ? null : page.edges.at(-1)!.cursor,
      cycleStartedAt: complete ? null : cycleStartedAt,
      watermark: complete ? cycleStartedAt : checkpoint.watermark,
    },
    complete,
  };
}

function validatePage(input: {
  page: z.infer<typeof pageSchema>;
  cursor: string | null;
  updates: boolean;
}) {
  if (input.page.pageInfo.hasNextPage && !input.page.edges.length) {
    throw new Error('Incomplete GitHub pagination.');
  }
  const seen = new Set(input.cursor ? [input.cursor] : []);
  let previousUpdatedAt = Infinity;
  for (const edge of input.page.edges) {
    if (seen.has(edge.cursor)) {
      throw new Error('GitHub repeated a cursor.');
    }
    seen.add(edge.cursor);
    const updatedAt = Date.parse(edge.node.updatedAt);
    if (input.updates && updatedAt > previousUpdatedAt) {
      throw new Error('GitHub returned pull requests out of update order.');
    }
    previousUpdatedAt = updatedAt;
  }
}

export const githubPullRequests = {
  key: 'github-pull-requests',
  name: 'Pull requests',
  description: 'Pull requests you authored, saved as searchable records.',
  intervalMs: 900_000,
  registration: {
    definition: {
      id: 'github.pull-requests',
      name: 'GitHub pull requests',
      configSchema: { type: 'object', additionalProperties: false },
      checkpointSchema: JSON.parse(JSON.stringify(z.toJSONSchema(checkpointSchema))),
      initialCheckpoint,
      kinds: { 'pull-request': JSON.parse(JSON.stringify(z.toJSONSchema(pullSchema))) },
      provider: { service: 'github', actions: [], proxyPostPaths: ['/graphql'] },
    },
    load: () => ({ step: stepGithubPullRequests }),
  },
} satisfies ContextSync;
