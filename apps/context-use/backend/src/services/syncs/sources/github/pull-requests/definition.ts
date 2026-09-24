import type { SyncContext, SyncRegistration, SyncStep } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { errorsSchema, postGithubGraphql } from '../request.ts';
import { githubRecord, pullSchema } from './record.ts';

// A GitHub cursor resumes pages within one polling iteration; it is not a change token.
// Keep the previous watermark while paging. Only a completed iteration advances it to
// iterationStartedAt: advancing to the finish time could skip edits made to PRs already read.
// For example, a 10:00–10:20 scan must revisit a PR edited at 10:05 on its next iteration.
const checkpointSchema = z.strictObject({
  // Reject continuation under a different connected account.
  accountId: z.string().nullable(),
  // Native page position; reset after completion or cursor expiry.
  cursor: z.string().nullable(),
  // Frozen before the first request; retained across pages, retries, and restarts.
  iterationStartedAt: z.iso.datetime({ offset: true }).nullable(),
  // Start of the last completed iteration; null until the initial backfill finishes.
  watermark: z.iso.datetime({ offset: true }).nullable(),
});
const initialCheckpoint = {
  accountId: null,
  cursor: null,
  iterationStartedAt: null,
  watermark: null,
};
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

// Creation order keeps backfill stable under edits. Later iterations start at the
// newest update and stop at the watermark; reusing a completed cursor would miss edits.
export async function stepGithubPullRequests(context: SyncContext): Promise<SyncStep> {
  context.signal.throwIfAborted();
  const checkpoint = checkpointSchema.parse(context.checkpoint);
  const iterationStartedAt = checkpoint.iterationStartedAt ?? new Date().toISOString();
  const updates = checkpoint.watermark !== null;
  const order = updates ? 'UPDATED_AT, direction: DESC' : 'CREATED_AT, direction: ASC';
  const response = await postGithubGraphql({
    context,
    body: {
      query: `query GithubPullRequests($after: String) { viewer { id pullRequests(first: ${PAGE_SIZE}, after: $after, orderBy: {field: ${order}}) { edges { cursor node { ${pullFields} } } pageInfo { hasNextPage } } } }`,
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
        // Replay this iteration from its first page without changing its update window.
        checkpoint: { ...checkpoint, cursor: null, iterationStartedAt },
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
  // Include cutoff ties and overlap timestamp precision/brief visibility delays.
  // Unchanged records in this window are suppressed by the engine's change detection.
  // Old PRs newly made visible, or changes without updatedAt, require an explicit resync.
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
      iterationStartedAt: complete ? null : iterationStartedAt,
      watermark: complete ? iterationStartedAt : checkpoint.watermark,
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
} satisfies SyncRegistration;
