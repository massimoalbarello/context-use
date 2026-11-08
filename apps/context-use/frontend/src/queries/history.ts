import { infiniteQueryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export const historyQueryKey = ['history'] as const;
export type HistoryPage = NonNullable<Awaited<ReturnType<typeof api.api.history.get>>['data']>;
export type HistoryEntry = HistoryPage['items'][number];
export type HistoryResourceType = HistoryEntry['resourceType'];

type HistoryDayCursor = { items: HistoryEntry[]; cursor: string | null };

export const historyQueryOptions = (resourceType?: HistoryResourceType) =>
  infiniteQueryOptions({
    queryKey: [...historyQueryKey, resourceType, Intl.DateTimeFormat().resolvedOptions().timeZone],
    initialPageParam: undefined as HistoryDayCursor | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const items: HistoryEntry[] = [];
      let remaining = pageParam?.items ?? [];
      let cursor = pageParam?.cursor;
      let day: string | undefined;
      // Finish a local calendar day before exposing it, even across API pages.
      // Retain the next day's entries so pagination neither loses nor repeats changes.
      for (;;) {
        day ??= remaining[0]?.createdAt.toLocaleDateString();
        const nextDay = remaining.findIndex(
          (entry) => entry.createdAt.toLocaleDateString() !== day,
        );
        if (nextDay !== -1) {
          return {
            items: items.concat(remaining.slice(0, nextDay)),
            next: { items: remaining.slice(nextDay), cursor: cursor ?? null },
          };
        }
        items.push(...remaining);
        if (cursor === null) {
          return { items, next: null };
        }
        const { data, error } = await api.api.history.get({
          query: { cursor, resourceType },
          fetch: { signal },
        });
        if (error) {
          throw new Error(apiErrorMessage(error));
        }
        remaining = data.items;
        cursor = data.nextCursor;
      }
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });
