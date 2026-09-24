import type { SyncContext } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import type { githubRecord } from '#backend/services/syncs/sources/github/pull-requests/record.ts';
export const now = '2026-09-17T12:00:00.000Z';
export function pull(
  input: { id?: string; title?: string; createdAt?: string; updatedAt?: string } = {},
): Parameters<typeof githubRecord>[0] {
  return {
    id: input.id ?? 'PR_one',
    number: 1,
    title: input.title ?? 'Improve local records',
    body: 'Keep **useful context**.',
    url: 'https://github.com/example/project/pull/1',
    state: 'OPEN',
    isDraft: false,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    repository: { nameWithOwner: 'example/project' },
    author: { id: 'U_owner', login: 'octocat' },
  };
}
export function page(
  input: { cursor?: string; nodes?: JsonObject[]; more?: boolean } = {},
): JsonObject {
  return {
    data: {
      viewer: {
        id: 'U_owner',
        pullRequests: {
          edges: (input.nodes ?? [pull()]).map(
            // biome-ignore lint/complexity/useMaxParams: Array.map supplies the fixture index.
            (node, index) => ({
              cursor: `${input.cursor ?? 'cursor'}-${index}`,
              node,
            }),
          ),
          pageInfo: { hasNextPage: input.more ?? false },
        },
      },
    },
  };
}

export function githubContext(input: {
  post: SyncContext['provider']['post'];
  checkpoint?: SyncContext['checkpoint'];
  signal?: AbortSignal;
}): SyncContext {
  const unexpected = () => {
    throw new Error('Unexpected provider or asset operation');
  };
  return {
    config: {},
    checkpoint: input.checkpoint ?? {
      accountId: null,
      cursor: null,
      iterationStartedAt: null,
      watermark: null,
    },
    syncId: 'sync',
    signal: input.signal ?? new AbortController().signal,
    provider: { post: input.post, get: unexpected, action: unexpected },
    assets: { capture: unexpected, unavailable: unexpected },
  };
}
