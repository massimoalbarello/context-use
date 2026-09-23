import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import { z } from 'zod';
import type { ContextSync } from '../../catalog.ts';
import { githubRecord, pullSchema } from './record.ts';
import { postGithubGraphql } from './request.ts';

const checkpointSchema = z.strictObject({
  accountId: z.string().nullable(),
  cursor: z.string().nullable(),
});
const initialCheckpoint = { accountId: null, cursor: null };
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

// Creation order is stable across updates. Each poll revisits all visible authored summaries,
// letting the engine deduplicate changes without gaps from mutable updatedAt ordering.
export async function stepGithubPullRequests(context: SyncContext): Promise<SyncStep> {
  context.signal.throwIfAborted();
  const checkpoint = checkpointSchema.parse(context.checkpoint);
  const response = await postGithubGraphql({
    context,
    body: {
      query: `query ContextUsePullRequests($after: String) { viewer { id pullRequests(first: ${PAGE_SIZE}, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) { edges { cursor node { ${pullFields} } } pageInfo { hasNextPage } } } }`,
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
      return { records: [], checkpoint: { ...checkpoint, cursor: null }, complete: false };
    }
    throw new Error('GitHub returned incomplete data.');
  }
  const { viewer } = responseSchema.parse(response.body).data;
  if (checkpoint.accountId && checkpoint.accountId !== viewer.id) {
    throw new Error('The connected GitHub account changed. Create a new sync.');
  }
  const page = viewer.pullRequests;
  if (page.pageInfo.hasNextPage && !page.edges.length) {
    throw new Error('Incomplete GitHub pagination.');
  }
  const seen = new Set(checkpoint.cursor ? [checkpoint.cursor] : []);
  const records = page.edges.map((edge) => {
    if (seen.has(edge.cursor)) {
      throw new Error('GitHub repeated a cursor.');
    }
    seen.add(edge.cursor);
    return githubRecord(edge.node);
  });
  context.signal.throwIfAborted();
  return {
    records,
    checkpoint: {
      accountId: viewer.id,
      cursor: page.pageInfo.hasNextPage ? page.edges.at(-1)!.cursor : null,
    },
    complete: !page.pageInfo.hasNextPage,
  };
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
